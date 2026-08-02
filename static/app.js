document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let filesData = [];
    let isRegisterMode = false;

    // Elements
    const authModal = document.getElementById('authModal');
    const authForm = document.getElementById('authForm');
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    const authError = document.getElementById('authError');
    const authUsername = document.getElementById('authUsername');
    const authPassword = document.getElementById('authPassword');
    
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadProgressContainer = document.getElementById('uploadProgressContainer');
    const uploadProgressBar = document.getElementById('uploadProgressBar');
    const uploadStatusText = document.getElementById('uploadStatusText');
    
    const fileListTable = document.getElementById('fileListTable');
    const emptyState = document.getElementById('emptyState');
    const searchInput = document.getElementById('searchInput');
    const storageText = document.getElementById('storageText');
    const storageBar = document.getElementById('storageBar');
    const fileCountText = document.getElementById('fileCountText');
    const userBadge = document.getElementById('userBadge');
    const usernameDisplay = document.getElementById('usernameDisplay');
    const logoutBtn = document.getElementById('logoutBtn');

    // Init Auth check
    const token = localStorage.getItem('vault_jwt_token');
    if (!token) {
        showAuthModal();
    } else {
        loadFiles();
    }

    // Toggle Auth Form
    tabLogin.addEventListener('click', () => setAuthMode(false));
    tabRegister.addEventListener('click', () => setAuthMode(true));

    function setAuthMode(register) {
        isRegisterMode = register;
        authError.classList.add('hidden');
        if (register) {
            tabRegister.classList.add('border-blue-500', 'text-blue-400');
            tabRegister.classList.remove('border-transparent', 'text-slate-400');
            tabLogin.classList.remove('border-blue-500', 'text-blue-400');
            tabLogin.classList.add('border-transparent', 'text-slate-400');
            authSubmitBtn.textContent = 'Create Account';
        } else {
            tabLogin.classList.add('border-blue-500', 'text-blue-400');
            tabLogin.classList.remove('border-transparent', 'text-slate-400');
            tabRegister.classList.remove('border-blue-500', 'text-blue-400');
            tabRegister.classList.add('border-transparent', 'text-slate-400');
            authSubmitBtn.textContent = 'Sign In';
        }
    }

    function showAuthModal() {
        authModal.classList.remove('hidden');
    }

    function hideAuthModal() {
        authModal.classList.add('hidden');
    }

    // Handle Authentication Submit
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authError.classList.add('hidden');
        const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: authUsername.value,
                    password: authPassword.value
                })
            });
            const data = await res.json();

            if (!res.ok) {
                authError.textContent = data.message || 'Authentication failed';
                authError.classList.remove('hidden');
                return;
            }

            localStorage.setItem('vault_jwt_token', data.token);
            if (data.user) {
                localStorage.setItem('vault_username', data.user.username);
            }
            hideAuthModal();
            showToast(data.message, 'success');
            loadFiles();
        } catch (err) {
            authError.textContent = 'Server error. Try again.';
            authError.classList.remove('hidden');
        }
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('vault_jwt_token');
        localStorage.removeItem('vault_username');
        filesData = [];
        renderFiles([]);
        showAuthModal();
        showToast('Logged out successfully');
    });

    // File Upload handling
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500', 'bg-blue-500/10');
    });

    ['dragleave', 'dragend'].forEach(evt => {
        dropZone.addEventListener(evt, () => {
            dropZone.classList.remove('border-blue-500', 'bg-blue-500/10');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-500/10');
        if (e.dataTransfer.files.length) {
            handleFiles(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            handleFiles(fileInput.files);
        }
    });

    async function handleFiles(files) {
        const token = localStorage.getItem('vault_jwt_token');
        if (!token) {
            showAuthModal();
            return;
        }

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('file', files[i]);
        }

        uploadProgressContainer.classList.remove('hidden');
        uploadProgressBar.style.width = '20%';
        uploadStatusText.textContent = 'Uploading file(s)...';

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload', true);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    uploadProgressBar.style.width = `${percent}%`;
                    uploadStatusText.textContent = `Uploading: ${percent}%`;
                }
            };

            xhr.onload = function() {
                uploadProgressContainer.classList.add('hidden');
                fileInput.value = '';
                if (xhr.status === 201) {
                    showToast('Files uploaded successfully', 'success');
                    loadFiles();
                } else {
                    const resp = JSON.parse(xhr.responseText || '{}');
                    showToast(resp.message || 'Upload failed', 'error');
                }
            };

            xhr.onerror = function() {
                uploadProgressContainer.classList.add('hidden');
                fileInput.value = '';
                showToast('Network error during upload', 'error');
            };

            xhr.send(formData);
        } catch (err) {
            uploadProgressContainer.classList.add('hidden');
            showToast('Failed to start upload', 'error');
        }
    }

    // Fetch and render files
    async function loadFiles() {
        const token = localStorage.getItem('vault_jwt_token');
        const savedUsername = localStorage.getItem('vault_username');
        
        if (savedUsername) {
            usernameDisplay.textContent = savedUsername;
            userBadge.classList.remove('hidden');
        }

        try {
            const res = await fetch('/api/files', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.status === 401) {
                showAuthModal();
                return;
            }

            const data = await res.json();
            filesData = data.files || [];
            updateStats(data.storage_used, data.total_files);
            renderFiles(filesData);
        } catch (err) {
            showToast('Error loading files', 'error');
        }
    }

    function renderFiles(files) {
        fileListTable.innerHTML = '';

        if (files.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        files.forEach(file => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-800/40 transition duration-150 animate-fade-in';

            const iconClass = getFileIcon(file.mime_type, file.name);
            const token = localStorage.getItem('vault_jwt_token');
            const downloadUrl = `${file.download_url}?token=${encodeURIComponent(token)}`;
            const shareFullUrl = `${window.location.origin}${file.share_url}`;

            tr.innerHTML = `
                <td class="px-4 py-3.5 font-medium text-slate-200 flex items-center space-x-3">
                    <i class="${iconClass} text-lg"></i>
                    <span class="truncate max-w-xs sm:max-w-md">${escapeHtml(file.name)}</span>
                </td>
                <td class="px-4 py-3.5 text-slate-400 text-xs">${formatBytes(file.size)}</td>
                <td class="px-4 py-3.5 text-slate-400 text-xs">${formatDate(file.uploaded_at)}</td>
                <td class="px-4 py-3.5 text-right space-x-2">
                    <a href="${downloadUrl}" download target="_blank" 
                       title="Download to Phone / PC storage"
                       class="inline-flex items-center space-x-1 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/30 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition duration-150">
                        <i class="fa-solid fa-download"></i>
                        <span class="hidden sm:inline">Save</span>
                    </a>
                    <button onclick="copyShareLink('${shareFullUrl}')" 
                            title="Copy Shareable Link"
                            class="inline-flex items-center space-x-1 bg-slate-700/50 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition duration-150">
                        <i class="fa-solid fa-link"></i>
                    </button>
                    <button onclick="deleteFile('${file.id}')" 
                            title="Delete file"
                            class="inline-flex items-center space-x-1 bg-red-500/10 hover:bg-red-600/80 text-red-400 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold transition duration-150">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            fileListTable.appendChild(tr);
        });
    }

    // Search filter
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = filesData.filter(f => f.name.toLowerCase().includes(query));
        renderFiles(filtered);
    });

    // File Deletion
    window.deleteFile = async function(fileId) {
        if (!confirm('Are you sure you want to delete this file?')) return;

        const token = localStorage.getItem('vault_jwt_token');
        try {
            const res = await fetch(`/api/files/${fileId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                showToast('File deleted', 'success');
                loadFiles();
            } else {
                showToast(data.message || 'Delete failed', 'error');
            }
        } catch (err) {
            showToast('Server error while deleting file', 'error');
        }
    };

    // Copy Shareable Link
    window.copyShareLink = function(url) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('Public link copied to clipboard!', 'success');
        }).catch(() => {
            showToast('Failed to copy link', 'error');
        });
    };

    // Storage calculation
    function updateStats(usedBytes, totalFiles) {
        const maxBytes = 500 * 1024 * 1024; // 500MB
        const percent = Math.min(100, Math.round((usedBytes / maxBytes) * 100));

        storageText.textContent = formatBytes(usedBytes);
        storageBar.style.width = `${percent}%`;
        fileCountText.textContent = totalFiles;
    }

    // Utilities
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function getFileIcon(mime, name) {
        const ext = name.split('.').pop().toLowerCase();
        if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
            return 'fa-solid fa-file-image text-purple-400';
        }
        if (mime.startsWith('video/') || ['mp4', 'mkv', 'mov', 'avi'].includes(ext)) {
            return 'fa-solid fa-file-video text-rose-400';
        }
        if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg'].includes(ext)) {
            return 'fa-solid fa-file-audio text-amber-400';
        }
        if (mime.includes('pdf') || ext === 'pdf') {
            return 'fa-solid fa-file-pdf text-red-400';
        }
        if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) {
            return 'fa-solid fa-file-zipper text-yellow-400';
        }
        if (['js', 'py', 'html', 'css', 'json'].includes(ext)) {
            return 'fa-solid fa-file-code text-emerald-400';
        }
        return 'fa-solid fa-file text-blue-400';
    }

    function escapeHtml(text) {
        return text.replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
        });
    }

    function showToast(msg, type = 'info') {
        const toast = document.getElementById('toast');
        const toastMessage = document.getElementById('toastMessage');
        const toastIcon = document.getElementById('toastIcon');

        toastMessage.textContent = msg;
        if (type === 'success') {
            toastIcon.className = 'fa-solid fa-circle-check text-emerald-400';
        } else if (type === 'error') {
            toastIcon.className = 'fa-solid fa-circle-exclamation text-red-400';
        } else {
            toastIcon.className = 'fa-solid fa-circle-info text-blue-400';
        }

        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(() => {
            toast.classList.add('translate-y-20', 'opacity-0');
        }, 3000);
    }
});