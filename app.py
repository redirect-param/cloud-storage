import os
import sqlite3
import uuid
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, render_template, send_from_directory, g
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = 'cloud-vault-jwt-secret-key-98765'
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max limit
DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cloud_storage.db')

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                mime_type TEXT NOT NULL,
                share_token TEXT UNIQUE NOT NULL,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        db.commit()

init_db()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
        
        if not token:
            token = request.args.get('token')

        if not token:
            return jsonify({'message': 'Authorization token missing'}), 401

        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            db = get_db()
            user = db.execute("SELECT id, username FROM users WHERE id = ?", (data['user_id'],)).fetchone()
            if not user:
                return jsonify({'message': 'User not found'}), 401
            g.current_user = user
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401

        return f(*args, **kwargs)
    return decorated

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({'message': 'Username and password required'}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        return jsonify({'message': 'Username already exists'}), 400

    user_id = str(uuid.uuid4())
    pw_hash = generate_password_hash(password)
    db.execute("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
               (user_id, username, pw_hash))
    db.commit()

    token = jwt.encode({
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(days=30)
    }, app.config['SECRET_KEY'], algorithm="HS256")

    return jsonify({
        'message': 'Account created successfully',
        'token': token,
        'user': {'id': user_id, 'username': username}
    }), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({'message': 'Username and password required'}), 400

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'message': 'Invalid credentials'}), 401

    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(days=30)
    }, app.config['SECRET_KEY'], algorithm="HS256")

    return jsonify({
        'message': 'Logged in successfully',
        'token': token,
        'user': {'id': user['id'], 'username': user['username']}
    })

@app.route('/api/upload', methods=['POST'])
@token_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({'message': 'No file part in the request'}), 400

    files = request.files.getlist('file')
    if not files or files[0].filename == '':
        return jsonify({'message': 'No selected file'}), 400

    uploaded_files = []
    db = get_db()

    for file in files:
        if file:
            orig_filename = secure_filename(file.filename) or f"file_{uuid.uuid4().hex[:8]}"
            ext = os.path.splitext(orig_filename)[1]
            file_id = str(uuid.uuid4())
            stored_filename = f"{file_id}{ext}"
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], stored_filename)

            file.save(file_path)
            file_size = os.path.getsize(file_path)
            mime_type = file.content_type or 'application/octet-stream'
            share_token = uuid.uuid4().hex[:12]

            db.execute('''
                INSERT INTO files (id, user_id, original_name, stored_name, file_size, mime_type, share_token)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (file_id, g.current_user['id'], orig_filename, stored_filename, file_size, mime_type, share_token))
            
            uploaded_files.append({
                'id': file_id,
                'name': orig_filename,
                'size': file_size,
                'mime_type': mime_type,
                'share_token': share_token
            })

    db.commit()
    return jsonify({'message': 'Files uploaded successfully', 'files': uploaded_files}), 201

@app.route('/api/files', methods=['GET'])
@token_required
def list_files():
    db = get_db()
    rows = db.execute('''
        SELECT id, original_name, file_size, mime_type, share_token, uploaded_at 
        FROM files WHERE user_id = ? ORDER BY uploaded_at DESC
    ''', (g.current_user['id'],)).fetchall()

    files = []
    total_bytes = 0
    for row in rows:
        total_bytes += row['file_size']
        files.append({
            'id': row['id'],
            'name': row['original_name'],
            'size': row['file_size'],
            'mime_type': row['mime_type'],
            'share_token': row['share_token'],
            'uploaded_at': row['uploaded_at'],
            'download_url': f"/api/download/{row['id']}",
            'share_url': f"/s/{row['share_token']}"
        })

    return jsonify({
        'files': files,
        'total_files': len(files),
        'storage_used': total_bytes
    })

@app.route('/api/download/<file_id>', methods=['GET'])
def download_file(file_id):
    token = request.args.get('token')
    user_id = None
    if token:
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            user_id = data['user_id']
        except Exception:
            pass

    db = get_db()
    file_record = db.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()

    if not file_record:
        return jsonify({'message': 'File not found'}), 404

    if file_record['user_id'] != user_id:
        share_key = request.args.get('key')
        if share_key != file_record['share_token']:
            return jsonify({'message': 'Unauthorized file access'}), 403

    return send_from_directory(
        app.config['UPLOAD_FOLDER'],
        file_record['stored_name'],
        as_attachment=True,
        download_name=file_record['original_name'],
        mimetype=file_record['mime_type']
    )

@app.route('/s/<share_token>', methods=['GET'])
def public_share(share_token):
    db = get_db()
    file_record = db.execute("SELECT * FROM files WHERE share_token = ?", (share_token,)).fetchone()
    if not file_record:
        return jsonify({'message': 'Shared link is invalid or expired'}), 404

    return send_from_directory(
        app.config['UPLOAD_FOLDER'],
        file_record['stored_name'],
        as_attachment=True,
        download_name=file_record['original_name'],
        mimetype=file_record['mime_type']
    )

@app.route('/api/files/<file_id>', methods=['DELETE'])
@token_required
def delete_file(file_id):
    db = get_db()
    file_record = db.execute("SELECT * FROM files WHERE id = ? AND user_id = ?", 
                             (file_id, g.current_user['id'])).fetchone()

    if not file_record:
        return jsonify({'message': 'File not found or unauthorized'}), 404

    file_path = os.path.join(app.config['UPLOAD_FOLDER'], file_record['stored_name'])
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass

    db.execute("DELETE FROM files WHERE id = ?", (file_id,))
    db.commit()

    return jsonify({'message': 'File deleted successfully'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)
