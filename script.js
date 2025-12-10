// ---------------------------
// FIREBASE SYNC LAYER
// ---------------------------
// Esperar a que Firebase esté inicializado desde HTML
function getDb() {
    return window.fbDb;
}

// Map of localStorage keys to Firebase paths
const FIREBASE_PATHS = {
    users: "users",
    posts: "posts",
    privateChats: "chats",
    groups: "groups",
    modLog: "modLog",
    muted: "muted"
};

let fbListenersActive = false;

// ---------------------------
// NOTIFICACIONES Y SONIDOS
// ---------------------------
let notificationEnabled = false;
let soundEnabled = true;
let unreadCount = 0;

// Solicitar permiso de notificaciones al iniciar
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                notificationEnabled = true;
                localStorage.setItem('notificationsEnabled', 'true');
            }
        });
    } else if ('Notification' in window && Notification.permission === 'granted') {
        notificationEnabled = true;
    }
}

// Reproducir sonido de notificación
function playNotificationSound() {
    if (!soundEnabled) return;
    try {
        // Crear un sonido simple usando Web Audio API
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(context.destination);
        
        oscillator.frequency.value = 800; // Frecuencia en Hz
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, context.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.2);
        
        oscillator.start(context.currentTime);
        oscillator.stop(context.currentTime + 0.2);
    } catch (e) {
        console.warn('No se pudo reproducir sonido:', e);
    }
}

// Mostrar notificación del navegador
function showBrowserNotification(title, options = {}) {
    if (!notificationEnabled || !('Notification' in window)) return;
    
    try {
        new Notification(title, {
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%234a9eff"/><text x="50" y="55" font-size="60" text-anchor="middle" fill="white">💬</text></svg>',
            badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%234a9eff"/></svg>',
            ...options
        });
    } catch (e) {
        console.warn('No se pudo mostrar notificación:', e);
    }
}

// Actualizar contador de mensajes no leídos en el título
function updateUnreadBadge() {
    const badge = unreadCount > 0 ? `(${unreadCount}) ` : '';
    document.title = badge + 'Chat App';
}

// Incrementar contador cuando hay nuevo mensaje
function incrementUnreadCount() {
    unreadCount++;
    updateUnreadBadge();
}

// Resetear contador al ver la sección
function resetUnreadCount() {
    unreadCount = 0;
    updateUnreadBadge();
}

// Controlar sonidos
function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('soundEnabled', soundEnabled);
}

// Controlar notificaciones del navegador
function toggleNotifications() {
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            notificationEnabled = !notificationEnabled;
            localStorage.setItem('notificationsEnabled', notificationEnabled);
        } else if (Notification.permission === 'denied') {
            showAlert('Las notificaciones están bloqueadas. Habilítalas en la configuración del navegador.');
        } else {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    notificationEnabled = true;
                    localStorage.setItem('notificationsEnabled', 'true');
                    const toggle = document.getElementById('notifToggle');
                    if (toggle) toggle.checked = true;
                    showAlert('✓ Notificaciones habilitadas');
                }
            });
        }
    } else {
        showAlert('Las notificaciones no están soportadas en tu navegador');
    }
}

// Probar notificación
function testNotification() {
    playNotificationSound();
    showBrowserNotification('🔔 ¡Prueba de notificación!', {
        body: 'Si ves este mensaje, las notificaciones funcionan correctamente.',
        tag: 'test-notification'
    });
    showAlert('✓ Notificación de prueba enviada');
}

// Sync localStorage to Firebase (push)
function syncToFirebase(key, value) {
    const db = getDb();
    if (!db) return;
    const path = FIREBASE_PATHS[key];
    if (!path) return;
    try {
        db.ref(path).set(value, (error) => {
            if (error && console) console.warn(`Firebase sync error for ${key}:`, error);
        });
    } catch(e) {
        console.warn('Firebase not ready:', e);
    }
}

// Load from Firebase (pull) - returns promise
function loadFromFirebase(key) {
    return new Promise((resolve) => {
        const db = getDb();
        if (!db) {
            console.warn('Firebase not available, using localStorage only');
            resolve(JSON.parse(localStorage.getItem(key) || 'null'));
            return;
        }
        const path = FIREBASE_PATHS[key];
        if (!path) {
            resolve(JSON.parse(localStorage.getItem(key) || 'null'));
            return;
        }
        try {
            // Set a timeout to avoid hanging forever
            const timeout = setTimeout(() => {
                console.warn(`Firebase read timeout for ${key}, using localStorage`);
                resolve(JSON.parse(localStorage.getItem(key) || 'null'));
            }, 3000);
            
            db.ref(path).once('value', (snapshot) => {
                clearTimeout(timeout);
                const data = snapshot.val();
                if (data !== null) {
                    // Normalize array data if needed
                    let toStore = data;
                    if (key === 'posts' && !Array.isArray(data) && typeof data === 'object') {
                        toStore = Object.values(data);
                    }
                    localStorage.setItem(key, JSON.stringify(toStore));
                    resolve(toStore);
                } else {
                    resolve(JSON.parse(localStorage.getItem(key) || 'null'));
                }
            }).catch((error) => {
                clearTimeout(timeout);
                console.warn(`Firebase read error for ${key}:`, error);
                resolve(JSON.parse(localStorage.getItem(key) || 'null'));
            });
        } catch(e) {
            console.warn('Firebase read error:', e);
            resolve(JSON.parse(localStorage.getItem(key) || 'null'));
        }
    });
}

// Initialize real-time listeners for automatic sync
function initFirebaseListeners() {
    const db = getDb();
    if (!db || fbListenersActive) return;
    fbListenersActive = true;
    try {
        db.ref(FIREBASE_PATHS.users).on('value', (snapshot) => {
            const data = snapshot.val();
            // Always write to localStorage; default to empty array when null
            localStorage.setItem('users', JSON.stringify(data || []));
        });
        db.ref(FIREBASE_PATHS.posts).on('value', (snapshot) => {
            const data = snapshot.val();
            // Ensure localStorage reflects remote state even when empty
            localStorage.setItem('posts', JSON.stringify(data || []));
            // Force forum refresh if visible
            if (document.getElementById('forumSection') && document.getElementById('forumSection').style.display !== 'none') {
                renderPosts();
            }
        });
        db.ref(FIREBASE_PATHS.privateChats).on('value', (snapshot) => {
            const data = snapshot.val();
            localStorage.setItem('privateChats', JSON.stringify(data || {}));
            // Force private chat refresh if visible
            if (document.getElementById('privateChatSection') && document.getElementById('privateChatSection').style.display !== 'none') {
                loadPrivateMessages();
            }
        });
        db.ref(FIREBASE_PATHS.groups).on('value', (snapshot) => {
            const data = snapshot.val();
            localStorage.setItem('groups', JSON.stringify(data || []));
            // Force group refresh if visible
            if (document.getElementById('groupChatSection') && document.getElementById('groupChatSection').style.display !== 'none') {
                loadGroups();
                if (activeGroup) loadGroupMessages();
            }
        });
        db.ref(FIREBASE_PATHS.modLog).on('value', (snapshot) => {
            const data = snapshot.val();
            localStorage.setItem('modLog', JSON.stringify(data || []));
        });
        db.ref(FIREBASE_PATHS.muted).on('value', (snapshot) => {
            const data = snapshot.val();
            localStorage.setItem('muted', JSON.stringify(data || []));
        });
    } catch(e) {
        console.warn('Firebase listeners error:', e);
    }
}

function formatDate(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"});
}

// Small DOM animation helper: add pop animation and remove it after it ends
function animatePop(el) {
    if (!el) return;
    try {
        el.classList.add('animate-pop');
        const onEnd = () => { el.classList.remove('animate-pop'); el.removeEventListener('animationend', onEnd); };
        el.addEventListener('animationend', onEnd);
        // Fallback removal after 1s in case animationend doesn't fire
        setTimeout(() => { el.classList.remove('animate-pop'); }, 1000);
    } catch (e) { console.warn('animatePop error', e); }
}

function currentUser() {
    return JSON.parse(localStorage.getItem("currentUser"));
}

function saveCurrentUser(user) {
    localStorage.setItem("currentUser", JSON.stringify(user));
    // update admin nav visibility when current user changes
    try { updateAdminNavVisibility(); } catch(e) {}
}

function updateAdminNavVisibility() {
    const nav = document.getElementById('adminNav');
    const me = currentUser();
    if (!nav) return;
    if (me && me.role === 'admin') nav.style.display = 'inline-block';
    else nav.style.display = 'none';
}

// Helpers to normalize users storage (Firebase may store arrays as objects)
function getUsers() {
    let raw = JSON.parse(localStorage.getItem('users') || '[]');
    if (!Array.isArray(raw) && raw && typeof raw === 'object') {
        // If stored as object (e.g., Firebase array->object), convert to array
        try {
            raw = Object.values(raw);
        } catch (e) {
            raw = [];
        }
    }
    return raw || [];
}

function saveUsers(users) {
    if (!Array.isArray(users)) users = Array.from(users || []);

    // Enforce single admin account 'Jade' with password 'Roedor78'
    const ADMIN_USERNAME = 'Jade';
    const ADMIN_PASSWORD = 'Roedor78';

    // Ensure the admin account exists and has the correct credentials (hashed)
    let admin = users.find(u => u && u.username === ADMIN_USERNAME);
    if (!admin) {
        // Create admin if missing
        admin = {
            username: ADMIN_USERNAME,
            passwordHash: hashPassword(ADMIN_PASSWORD),
            avatar: DEFAULT_AVATARS[0],
            role: 'admin'
        };
        users.unshift(admin);
    } else {
        // Ensure admin has correct password hash and role
        admin.passwordHash = hashPassword(ADMIN_PASSWORD);
        admin.role = 'admin';
        if (!admin.avatar) admin.avatar = DEFAULT_AVATARS[0];
    }

    // Demote any other admin accounts to 'user' to guarantee uniqueness
    users = users.map(u => {
        if (!u) return u;
        if (u.username === ADMIN_USERNAME) return u;
        if (u.role === 'admin') u.role = 'user';
        return u;
    });

    localStorage.setItem('users', JSON.stringify(users));
    // ensure Firebase mirror
    try {
        syncToFirebase('users', users);
    } catch (e) {
        console.warn('sync users failed', e);
    }
}

// Helpers to normalize posts storage (Firebase may store arrays as objects)
function getPosts() {
    let raw = JSON.parse(localStorage.getItem('posts') || '[]');
    if (!Array.isArray(raw) && raw && typeof raw === 'object') {
        // If stored as object (e.g., Firebase array->object), convert to array
        try {
            raw = Object.values(raw);
        } catch (e) {
            raw = [];
        }
    }
    // Normalize each post to ensure replies exists
    if (Array.isArray(raw)) {
        raw = raw.map(post => ({
            ...post,
            replies: Array.isArray(post.replies) ? post.replies : []
        }));
    }
    return raw || [];
}

function savePosts(posts) {
    if (!Array.isArray(posts)) posts = Array.from(posts || []);
    localStorage.setItem('posts', JSON.stringify(posts));
    // ensure Firebase mirror
    try { 
        syncToFirebase('posts', posts); 
    } catch (e) { 
        console.warn('sync posts failed', e); 
    }
}

function showSection(id) {
    document.querySelectorAll(".container").forEach(c => c.style.display = "none");
    document.getElementById("navBar").style.display = "block";
    // Prevent non-admins from opening admin section
    if (id === 'adminSection') {
        const me = currentUser();
        if (!me || me.role !== 'admin') {
            showAlert('No tienes permiso para acceder al panel de administración');
            return;
        }
    }
    document.getElementById(id).style.display = "block";

    if (id === "forumSection") {
        // Cargar datos desde Firebase antes de renderizar
        loadFromFirebase('posts').then(() => {
            console.log('Forum loaded from Firebase, rendering posts...');
            renderPosts();
        });
    }

    if (id === "privateChatSection") {
        // Ensure we have latest users and private chats from Firebase before rendering
        Promise.all([loadFromFirebase('users'), loadFromFirebase('privateChats')])
            .then(() => {
                loadUsers();
                // If an active chat is selected, reload its messages
                if (activeChat) loadPrivateMessages();
            });
    }

    if (id === "groupChatSection") {
        // Ensure we have latest groups and users before rendering group UI
        Promise.all([loadFromFirebase('groups'), loadFromFirebase('users')])
            .then(() => {
                loadGroups();
                if (activeGroup) loadGroupMessages();
            });
    }
    if (id === "profileSection") {
        loadProfile();
        initAvatarGrid();
    }
    if (id === "adminSection") {
        // Make sure we have freshest users list before rendering admin panel
        loadFromFirebase('users').then(() => refreshAdminPanel());
    }
}

function autoGrow(elem) {
    elem.style.height = "auto";
    elem.style.height = elem.scrollHeight + "px";
}

// Manejo de menciones con @
function handleMentions(textarea) {
    const text = textarea.value;
    const lastAtIndex = text.lastIndexOf('@');
    
    if (lastAtIndex === -1) {
        // No hay @, ocultar dropdown
        const dropdown = textarea.parentElement.querySelector('.mentions-dropdown');
        if (dropdown) dropdown.style.display = 'none';
        return;
    }
    
    // Obtener texto después del @
    const afterAt = text.substring(lastAtIndex + 1);
    
    // Si hay espacios después del @, ocultar dropdown
    if (afterAt.includes(' ')) {
        const dropdown = textarea.parentElement.querySelector('.mentions-dropdown');
        if (dropdown) dropdown.style.display = 'none';
        return;
    }
    
    // Buscar usuarios que coincidan
    const users = getUsers();
    const matches = users.filter(u => u.username.toLowerCase().startsWith(afterAt.toLowerCase()));
    
    const dropdown = textarea.parentElement.querySelector('.mentions-dropdown');
    if (!dropdown) return;
    
    if (matches.length === 0 || afterAt.length === 0) {
        dropdown.style.display = 'none';
        return;
    }
    
    // Mostrar dropdown
    dropdown.style.display = 'block';
    dropdown.innerHTML = matches.map(u => `
        <div style="padding:8px;cursor:pointer;border-bottom:1px solid #444;" onclick="insertMention('${u.username}', this.parentElement.parentElement.querySelector('textarea'))">@${u.username}</div>
    `).join('');
}

// Insertar mención en el textarea
function insertMention(username, textarea) {
    const text = textarea.value;
    const lastAtIndex = text.lastIndexOf('@');
    const beforeAt = text.substring(0, lastAtIndex);
    
    textarea.value = beforeAt + '@' + username + ' ';
    autoGrow(textarea);
    
    // Ocultar dropdown
    const dropdown = textarea.parentElement.querySelector('.mentions-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    
    // Enfocar textarea
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

// ---------------------------
// LOGIN + REGISTRO
// ---------------------------
function registerOrLogin() {
    let user = document.getElementById("username").value.trim();
    let pass = document.getElementById("password").value.trim();

    if (!user || !pass) return;

    let users = getUsers();

    let exists = users.find(u => u.username === user);

    // Enforce single admin account 'Jade' with password 'Roedor78'
    const ADMIN_USERNAME = 'Jade';
    const ADMIN_PASSWORD = 'Roedor78';

    // Check for lockout on admin account: after 3 failed attempts require 1 hour wait
    if (user === ADMIN_USERNAME) {
        const attempts = getFailedAdminAttempts();
        const now = Date.now();
        // consider only attempts within a reasonable window (e.g., last 24h) when computing recent list
        const recent = attempts.filter(a => (now - a.time) < (24 * 3600 * 1000));
        if (recent.length >= 3) {
            // compute lock start as time of the LAST (most recent) failed attempt
            const lastAttempt = recent[recent.length - 1];
            const lockUntil = lastAttempt.time + (60 * 60 * 1000); // 1 hour from the last attempt
            if (now < lockUntil) {
                const unlockAt = new Date(lockUntil).toLocaleString();
                showAlert(`Cuenta de administrador bloqueada temporalmente. Intenta de nuevo a las ${unlockAt}`);
                return;
            }
        }
    }

    if (!exists) {
        // Special-case: creating the fixed admin account
        if (user === ADMIN_USERNAME) {
            if (pass !== ADMIN_PASSWORD) {
                addFailedAdminAttempt(user, pass);
                showAlert('Credenciales incorrectas para administrador');
                return;
            }
            exists = {
                username: ADMIN_USERNAME,
                passwordHash: hashPassword(ADMIN_PASSWORD),
                avatar: DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)],
                role: 'admin'
            };
            users.push(exists);
            saveUsers(users);
        } else {
            // Regular user creation (never admin)
            exists = {
                username: user,
                passwordHash: hashPassword(pass),
                avatar: DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)],
                role: 'user'
            };
            users.push(exists);
            saveUsers(users);
        }
    }

    // Validate password (compare hashes)
    if (!verifyPassword(pass, exists.passwordHash)) {
        // If this was an attempt to log in as the protected admin, record it
        if (user === ADMIN_USERNAME) addFailedAdminAttempt(user, pass);
        showAlert("Contraseña incorrecta");
        return;
    }

    saveCurrentUser(exists);

    document.getElementById("loginSection").style.display = "none";
    
    // Solicitar permisos de notificación
    requestNotificationPermission();
    
    // Mostrar notificación de bienvenida
    showBrowserNotification(`¡Bienvenido, ${exists.username}!`, {
        body: 'Sesión iniciada correctamente',
        tag: 'login'
    });
    
    // Update admin nav visibility
    updateAdminNavVisibility();
    
    // Initialize Firebase listeners on login
    initFirebaseListeners();
    
    showSection("forumSection");
}

function logout() {
    localStorage.removeItem("currentUser");
    location.reload();
}

// ---------------------------
// PERFIL
// ---------------------------
function loadProfile() {
    let u = currentUser();
    document.getElementById("profileName").textContent = u.username;
    document.getElementById("roleText").textContent = "Rol: " + u.role;
    document.getElementById("profileImgPreview").src = u.avatar || "";
    
    // Cargar preferencias de notificaciones
    const soundToggle = document.getElementById("soundToggle");
    const notifToggle = document.getElementById("notifToggle");
    
    if (soundToggle) soundToggle.checked = soundEnabled;
    if (notifToggle) notifToggle.checked = notificationEnabled;
    
    initAvatarGrid();
}

function uploadProfilePhoto() {
    let file = document.getElementById("profileImgInput").files[0];
    if (!file) return;

    let reader = new FileReader();
    reader.onload = function (e) {
        let users = getUsers();
        let u = currentUser();

        let obj = users.find(a => a.username === u.username);
        obj.avatar = e.target.result;

        saveUsers(users);
        
        saveCurrentUser(obj);

        loadProfile();
    };
    reader.readAsDataURL(file);
}

// ---------------------------
// FORO
// ---------------------------
function addPost() {
    const text = document.getElementById("forumMsg").value.trim();
    const file = document.getElementById('postFileInput') ? document.getElementById('postFileInput').files[0] : null;
    if (!text && !file) return;

    // Prevent muted users from posting
    if (isMuted(currentUser().username)) {
        showAlert('Estás silenciado y no puedes publicar mensajes');
        return;
    }

    const user = currentUser();

    const posts = getPosts();

    // If there's a file, read it and attach; otherwise create post immediately
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const attachment = { type: file.type && file.type.startsWith('image') ? 'img' : 'file', text: e.target.result };
            const newPost = {
                id: Date.now(),
                user: user.username,
                avatar: user.avatar,
                text: text || '',
                attachment: attachment,
                replies: [],
                date: new Date().toISOString()
            };
            posts.push(newPost);
            savePosts(posts);
            document.getElementById("forumMsg").value = "";
            document.getElementById('postFileInput').value = '';
            // mark for animation after render
            try { window._lastNewPostId = newPost.id; } catch(e){}
            // Forzar recarga desde Firebase para asegurar sincronización
            loadFromFirebase('posts').then(() => renderPosts());
        };
        reader.readAsDataURL(file);
        return;
    }

    const newPost = {
        id: Date.now(),
        user: user.username,
        avatar: user.avatar,
        text: text,
        replies: [],
        date: new Date().toISOString()
    };

    posts.push(newPost);
    savePosts(posts);

    document.getElementById("forumMsg").value = "";

    // Notificar a otros usuarios sobre el nuevo post
    showBrowserNotification('Nuevo post en el foro', {
        body: `${user.username}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
        tag: 'new-post'
    });
    playNotificationSound();

    // Forzar recarga desde Firebase para asegurar sincronización
    try { window._lastNewPostId = newPost.id; } catch(e){}
    loadFromFirebase('posts').then(() => renderPosts());
}

function renderPosts() {
    const me = currentUser();
    if (!me) return; // No user logged in
    
    const posts = getPosts();
    const container = document.getElementById("posts");

    if (!container) return;
    
    // Guardar estado de los cuadros de respuesta abiertos Y el foco
    const openReplyBoxes = {};
    let focusedReplyBox = null;
    document.querySelectorAll('[id^="replyBox-"]').forEach(box => {
        const textarea = box.querySelector('textarea');
        if (textarea && document.activeElement === textarea) {
            focusedReplyBox = box.id.replace('replyBox-', '');
        }
        if (box.innerHTML.trim()) {
            const postId = box.id.replace('replyBox-', '');
            openReplyBoxes[postId] = box.innerHTML;
        }
    });
    
    container.innerHTML = "";

    // Diagnóstico
    console.log('renderPosts - posts count:', posts.length, 'posts:', posts);

    // Si no hay posts, mostrar mensaje
    if (!posts || posts.length === 0) {
        container.innerHTML = "<p style='text-align:center;color:#888;'>No hay mensajes aún. ¡Sé el primero en publicar!</p>";
        return;
    }

    // Mostrar en orden invertido (mensajes recientes primero)
    let reversedPosts = posts.slice().reverse();
    const role = me.role;

    reversedPosts.forEach(post => {
        const div = document.createElement("div");
        div.className = "post";
        let deleteButton = "";
        if (!post._deleted && (role === "admin" || role === "moderator")) {
            deleteButton = `<button class="delete-btn" onclick="deletePost(${post.id})" title="Eliminar post">✕</button>`;
        }

        let editButton = "";
        if (!post._deleted && ((me.username === post.user) || role === 'admin' || role === 'moderator')) {
            editButton = `<button class="edit-btn" onclick="editPost(${post.id})" title="Editar">✎</button>`;
        }

        div.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <img src="${post.avatar}" class="profile-img" style="width:40px;height:40px">
                    <strong>${post.user}</strong>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div class="msg-time">${formatDate(new Date(post.date).getTime())}</div>
                    ${deleteButton} ${editButton}
                </div>
            </div>

                <p>${post._deleted ? (role === 'admin' || role === 'moderator' ? post.text : '<em>Mensaje eliminado</em>') : (post.text || '')}</p>
                ${post.attachment ? (post._deleted ? (role === 'admin' || role === 'moderator' ? (post.attachment.type === 'img' ? `<div style="margin-top:6px;"><img src="${post.attachment.text}" class="msg-img"></div>` : `<div style="margin-top:6px;"><a class="msg-file" href="${post.attachment.text}" download>Descargar archivo</a></div>`) : '') : (post.attachment.type === 'img' ? `<div style="margin-top:6px;"><img src="${post.attachment.text}" class="msg-img"></div>` : `<div style="margin-top:6px;"><a class="msg-file" href="${post.attachment.text}" download>Descargar archivo</a></div>`)) : ''}

            ${post._deleted ? '' : `<button onclick="openReplyBox(${post.id})">Responder</button>`}
            <div id="replyBox-${post.id}"></div>

            <div class="replies">
                ${(post.replies || []).map(r => {
                    const rDeleted = r._deleted;
                    let deleteReplyBtn = "";
                    let editReplyBtn = "";
                    if (!rDeleted && (role === "admin" || role === "moderator")) {
                        deleteReplyBtn = `<button class="delete-btn" onclick="deleteReply(${post.id}, '${r.date}')" title="Eliminar respuesta">✕</button>`;
                    }
                    if (!rDeleted && ((me.username === r.user) || role === 'admin' || role === 'moderator')) {
                        editReplyBtn = `<button class="edit-btn" onclick="editReply(${post.id}, '${r.date}')" title="Editar">✎</button>`;
                    }
                    const replyText = rDeleted ? (role === 'admin' || role === 'moderator' ? r.text : '<em>Respuesta eliminada</em>') : r.text;
                    let editsHtml = '';
                    if (r.edits && (role === 'admin' || role === 'moderator')) {
                        // small inline history kept for quick view
                        editsHtml = `<div style="font-size:12px;color:#bbb;margin-top:6px;">Historial ediciones:` + (r.edits.map(e => `<div>${new Date(e.time).toLocaleString()}: ${e.oldText}</div>`).join('')) + `</div>`;
                    }
                    // Also show edit snapshot block for admins/mods
                    let editSnapshotHtml = '';
                    if (r.edits && r.edits.length && (role === 'admin' || role === 'moderator')) {
                        const edits = r.edits.slice().reverse();
                        editSnapshotHtml = edits.map(e => `<div style="margin-top:6px;border-top:1px solid #444;padding-top:6px;color:#ccc;"><strong>Editado por ${e.editor} el ${new Date(e.time).toLocaleString()}</strong><div style="margin-top:4px;color:#ddd">${e.oldText}</div></div>`).join('');
                        editSnapshotHtml = `<div style="margin-top:8px;padding:8px;background:#2b2d31;border-radius:6px;color:#ccc;"><strong>Historial de ediciones</strong>${editSnapshotHtml}</div>`;
                    }
                    let deletedPhotoHtml = '';
                    if (r._deleted && r._deletedData && r._deletedData.type && r._deletedData.type === 'img' && (role === 'admin' || role === 'moderator')) {
                        deletedPhotoHtml = `<div style="margin-top:6px;"><em>Foto eliminada:</em><br><img src="${r._deletedData.text}" class="msg-img"></div>`;
                    }
                    return `
                        <div class="post reply">
                            <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;">
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <img src="${r.avatar}" class="profile-img" style="width:35px;height:35px">
                                    <strong>${r.user}</strong>
                                </div>
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <div class="msg-time">${formatDate(new Date(r.date).getTime())}</div>
                                    ${deleteReplyBtn}
                                    ${editReplyBtn}
                                </div>
                            </div>
                            <p>${replyText}</p>
                            ${editsHtml}
                            ${deletedPhotoHtml}
                            ${editSnapshotHtml}
                        </div>
                    `;
                }).join("")}
            </div>

            `;

        // If post is deleted and we are admin/mod, show deleted snapshot below
        if (post._deleted && (role === 'admin' || role === 'moderator')) {
            const snap = post._deletedData;
            if (snap) {
                let attHtml = '';
                if (snap.attachment) {
                    if (snap.attachment.type === 'img') attHtml = `<div style="margin-top:6px;"><img src="${snap.attachment.text}" class="msg-img"></div>`;
                    else attHtml = `<div style="margin-top:6px;"><a class="msg-file" href="${snap.attachment.text}" download>Descargar archivo</a></div>`;
                }
                const snapHtml = `<div style="margin-top:8px;padding:8px;background:#2b2d31;border-radius:6px;color:#ccc;"><strong>Contenido eliminado por ${post._deletedBy} el ${new Date(post._deletedAt).toLocaleString()}</strong><div style="margin-top:6px;">${snap.text ? snap.text : ''}</div>` + attHtml + (snap.replies && snap.replies.length ? `<div style="margin-top:6px;color:#999">Respuestas originales: ${snap.replies.length}</div>` : '') + `</div>`;
                div.innerHTML += snapHtml;
            }
        }

        // Show edit snapshots to admins/mods similar to deleted snapshot
        if (post.edits && post.edits.length && (role === 'admin' || role === 'moderator')) {
            // show full history (most recent first)
            const edits = post.edits.slice().reverse();
            const editsHtml = edits.map(e => `<div style="margin-top:6px;border-top:1px solid #444;padding-top:6px;color:#ccc;"><strong>Editado por ${e.editor} el ${new Date(e.time).toLocaleString()}</strong><div style="margin-top:4px;color:#ddd">${e.oldText}</div></div>`).join('');
            const box = `<div style="margin-top:8px;padding:8px;background:#2b2d31;border-radius:6px;color:#ccc;"><strong>Historial de ediciones</strong>${editsHtml}</div>`;
            div.innerHTML += box;
        }

        // mark DOM element with post id for possible animation targeting
        try { div.dataset.postId = post.id; } catch(e) {}
        container.appendChild(div);
    });
    // If a new post was just created, animate it
    try {
        if (window._lastNewPostId) {
            const el = container.querySelector('[data-post-id="' + window._lastNewPostId + '"]');
            if (el) animatePop(el);
            delete window._lastNewPostId;
        }
    } catch (e) { /* ignore */ }
    
    // Restaurar cuadros de respuesta abiertos
    Object.keys(openReplyBoxes).forEach(postId => {
        const box = document.getElementById('replyBox-' + postId);
        if (box) {
            box.innerHTML = openReplyBoxes[postId];
        }
    });
    
    // Restaurar el foco al cuadro de respuesta si había uno abierto
    if (focusedReplyBox) {
        const textarea = document.getElementById('replyText-' + focusedReplyBox);
        if (textarea) {
            setTimeout(() => textarea.focus(), 0);
        }
    }
}

function openReplyBox(id) {
    const box = document.getElementById("replyBox-" + id);

    box.innerHTML = `
        <textarea id="replyText-${id}" oninput="autoGrow(this); handleMentions(this)" placeholder="Responder... (usa @ para mencionar)"></textarea>
        <div id="mentions-${id}" class="mentions-dropdown" style="display:none;position:absolute;background:#2b2d31;border:1px solid #444;border-radius:4px;max-height:150px;overflow-y:auto;z-index:100;"></div>
        <button onclick="sendReply(${id})">Enviar</button>
    `;
}

function sendReply(id) {
    const text = document.getElementById("replyText-" + id).value.trim();
    if (!text) return;

    const user = currentUser();
    let posts = getPosts();

    let post = posts.find(p => p.id === id);

    post.replies.push({
        user: user.username,
        avatar: user.avatar,
        text: text,
        date: new Date().toISOString()
    });

    savePosts(posts);

    // Limpiar el cuadro de respuesta
    const box = document.getElementById("replyBox-" + id);
    if (box) box.innerHTML = "";

    // Notificar sobre la nueva respuesta
    const postAuthor = post.user;
    if (postAuthor !== user.username) {
        showBrowserNotification('Nueva respuesta', {
            body: `${user.username} respondió a tu post`,
            tag: 'new-reply-' + id
        });
    }
    playNotificationSound();
    incrementUnreadCount();

    renderPosts();
}

function deletePost(id) {
    showConfirm("¿Eliminar este post?", function(result) {
        if (!result) return;

        const me = currentUser();
        let posts = getPosts();
        const post = posts.find(p => p.id === id);
        const target = post ? post.user : null;

        if (post) {
            // mark as deleted and keep content for admins/mods
            post._deleted = true;
            post._deletedBy = me ? me.username : 'unknown';
            post._deletedAt = Date.now();
            // store previous content snapshot (include attachment if present)
            post._deletedData = { user: post.user, avatar: post.avatar, text: post.text, replies: post.replies, date: post.date, attachment: post.attachment };
            savePosts(posts);
            // Force sync to Firebase explicitly
            setTimeout(() => {
                syncToFirebase('posts', JSON.parse(localStorage.getItem('posts') || '[]'));
            }, 100);
            addModLog('delete_post', me ? me.username : 'unknown', id, `Autor: ${target}`);
            renderPosts();
        }
    });
}

function deleteReply(postId, replyDate) {
    showConfirm("¿Eliminar esta respuesta?", function(result) {
        if (!result) return;

        const me = currentUser();
        let posts = getPosts();
        let post = posts.find(p => p.id === postId);
        if (post) {
            let reply = post.replies.find(r => r.date === replyDate);
            if (reply) {
                reply._deleted = true;
                reply._deletedBy = me ? me.username : 'unknown';
                reply._deletedAt = Date.now();
                reply._deletedData = { user: reply.user, avatar: reply.avatar, text: reply.text, date: reply.date, type: reply.type };
                savePosts(posts);
                syncToFirebase('posts', posts);
                addModLog('delete_reply', me ? me.username : 'unknown', postId, `replyAuthor: ${reply.user}`);
                renderPosts();
            }
        }
    });
}

    // Edición de posts y respuestas
    function showEditPrompt(message, initialText, callback) {
        promptCallback = callback;
        document.getElementById('promptMessage').textContent = message;
        document.getElementById('promptInput').value = initialText || '';
        showModal('promptModal');
        document.getElementById('promptInput').focus();
    }

    function editPost(id) {
        let posts = getPosts();
        const post = posts.find(p => p.id === id);
        if (!post) return;

        const me = currentUser();
        const role = me.role;
        if (me.username !== post.user && role !== 'admin' && role !== 'moderator') {
            showAlert('No tienes permiso para editar este post');
            return;
        }

        showEditPrompt('Editar post:', post.text, function(val) {
            if (val === null) return;
            const newText = val.trim();
            if (newText === post.text) return;
            post.edits = post.edits || [];
            const old = post.text;
            post.edits.push({ time: Date.now(), oldText: old, editor: me.username });
            post.text = newText;
            savePosts(posts);
            addModLog('edit_post', me.username, id, `old:${old}`);
            renderPosts();
        });
    }

    function editReply(postId, replyDate) {
        let posts = getPosts();
        const post = posts.find(p => p.id === postId);
        if (!post) return;
        const reply = post.replies.find(r => r.date === replyDate);
        if (!reply) return;

        const me = currentUser();
        const role = me.role;
        if (me.username !== reply.user && role !== 'admin' && role !== 'moderator') {
            showAlert('No tienes permiso para editar esta respuesta');
            return;
        }

        showEditPrompt('Editar respuesta:', reply.text, function(val) {
            if (val === null) return;
            const newText = val.trim();
            if (newText === reply.text) return;
            reply.edits = reply.edits || [];
            const old = reply.text;
            reply.edits.push({ time: Date.now(), oldText: old, editor: me.username });
            reply.text = newText;
            savePosts(posts);
            addModLog('edit_reply', me.username, postId, `replyAuthor:${reply.user}; old:${old}`);
            renderPosts();
        });
    }

// AUTO-REFRESH FORO
// (Removido) auto-refresh frecuente — ahora se usa handleStorageSync

// -------------------------------------
// CHATS PRIVADOS
// -------------------------------------
let activeChat = null;
let typingTimeout = null;

function loadUsers() {
    const users = getUsers();
    const u = currentUser();
    const list = document.getElementById("userList");

    list.innerHTML = "";

    users.forEach(user => {
        if (user.username === u.username) return;

        const div = document.createElement("div");
        div.className = "user-item";

        div.innerHTML = `
            <img src="${user.avatar}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;">
            ${user.username}
        `;

        div.onclick = () => openPrivateChat(user.username);
        list.appendChild(div);
    });
}

function openPrivateChat(user) {
    activeChat = user;
    document.getElementById("chatWith").innerText = "Chat con " + user;
    loadPrivateMessages();
}

function loadPrivateMessages() {
    if (!activeChat) return;

    const u = currentUser().username;
    const chats = JSON.parse(localStorage.getItem("privateChats") || "{}");
    const key = [u, activeChat].sort().join("_");
    let msgs = chats[key] || [];

    const role = currentUser().role;

    const container = document.getElementById("chatMessages");
    container.innerHTML = "";

    // Mostrar en orden normal (primero publicados primero)
    msgs = msgs.slice();

    msgs.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg-bubble " + (m.from === u ? "me" : "other");

        let content = "";
        // If deleted, show placeholder for regular users, snapshot for admins/mods
        if (m._deleted) {
            if (role === 'admin' || role === 'moderator') {
                const snap = m._deletedData || {};
                let deletedContent = '<em>Mensaje eliminado</em>';
                if (snap.type === 'img') {
                    deletedContent = `<img class="msg-img" src="${snap.text}">`;
                } else if (snap.type === 'file') {
                    deletedContent = `<a class="msg-file" href="${snap.text}" download>Descargar archivo (eliminado)</a>`;
                } else if (snap.text) {
                    deletedContent = snap.text;
                }
                content = `<em style="color:#888;">Mensaje eliminado por ${m._deletedBy}</em><br>${deletedContent}`;
            } else {
                content = '<em>Mensaje eliminado</em>';
            }
        } else {
            if (m.type === "text") {
                content = m.text;
            } else if (m.type === "img") {
                content = `<img class="msg-img" src="${m.text}">`;
            } else if (m.type === "file") {
                content = `<a class="msg-file" href="${m.text}" download>Descargar archivo</a>`;
            }
        }

        let editsHtml = '';
        if (m.edits && (role === 'admin' || role === 'moderator')) {
            editsHtml = `<div style="font-size:12px;color:#bbb;margin-top:6px;">Historial ediciones:` + (m.edits.map(e => `<div>${new Date(e.time).toLocaleString()}: ${e.oldText}</div>`).join('')) + `</div>`;
        }
        // edit snapshot block for admins/mods
        let editSnapshotHtml = '';
        if (m.edits && m.edits.length && (role === 'admin' || role === 'moderator')) {
            const edits = m.edits.slice().reverse();
            const editsBlock = edits.map(e => `<div style="margin-top:6px;border-top:1px solid #444;padding-top:6px;color:#ccc;"><strong>Editado por ${e.editor} el ${new Date(e.time).toLocaleString()}</strong><div style="margin-top:4px;color:#ddd">${e.oldText}</div></div>`).join('');
            editSnapshotHtml = `<div style="margin-top:8px;padding:8px;background:#2b2d31;border-radius:6px;color:#ccc;"><strong>Historial de ediciones</strong>${editsBlock}</div>`;
        }
        let deletedPhotoHtml = '';
        if (m._deleted && m._deletedData && m._deletedData.type === 'img' && (role === 'admin' || role === 'moderator')) {
            deletedPhotoHtml = `<div style="margin-top:6px;"><em>Foto eliminada:</em><br><img src="${m._deletedData.text}" class="msg-img"></div>`;
        }

        let deleteBtn = "";
        let editBtn = "";
        if (!m._deleted && (role === "admin" || role === "moderator")) {
            deleteBtn = `<button class="delete-btn" onclick="deletePrivateMsg('${key}', ${m.date})" title="Eliminar">✕</button>`;
        }
        if (!m._deleted && ((m.from === u) || role === 'admin' || role === 'moderator')) {
            editBtn = `<button class="edit-btn" onclick="editPrivateMsg('${key}', ${m.date})" title="Editar">✎</button>`;
        }

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                <div style="flex: 1;">${content}</div>
                ${deleteBtn} ${editBtn}
            </div>
            <div class="msg-time">${formatDate(m.date)}</div>
            ${editsHtml}
            ${deletedPhotoHtml}
            ${editSnapshotHtml}
        `;

        container.appendChild(div);
    });

    // Scroll al inicio para ver mensajes nuevos
    // Scroll to bottom so latest messages are visible
    container.scrollTop = container.scrollHeight;
}

function sendPrivateMessage() {
    if (!activeChat) return;
    // Prevent muted users from sending private messages
    if (isMuted(currentUser().username)) {
        showAlert('Estás silenciado y no puedes enviar mensajes privados');
        return;
    }
    const input = document.getElementById("privateMsg");
    const text = input.value.trim();
    const file = document.getElementById("fileInput").files[0];

    if (!text && !file) return;

    const u = currentUser().username;
    const chats = JSON.parse(localStorage.getItem("privateChats") || "{}");
    const key = [u, activeChat].sort().join("_");

    if (!chats[key]) chats[key] = [];

    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const ts = Date.now();
            chats[key].push({
                from: u,
                type: file.type.startsWith("image") ? "img" : "file",
                text: e.target.result,
                date: ts
            });
            try { window._lastNewPrivateMsg = { key: key, date: ts }; } catch(e) {}
            localStorage.setItem("privateChats", JSON.stringify(chats));
            syncToFirebase('privateChats', chats);
            // clear inputs after sending
            document.getElementById("privateMsg").value = "";
            document.getElementById("privateMsg").style.height = "auto";
            const fi = document.getElementById("fileInput");
            if (fi) fi.value = "";
            loadPrivateMessages();
        };
        reader.readAsDataURL(file);
        return;
    }

    if (text) {
        const ts = Date.now();
        chats[key].push({
            from: u,
            type: "text",
            text: text,
            date: ts
        });
        // remember last private message to animate after render
        try { window._lastNewPrivateMsg = { key: key, date: ts }; } catch(e) {}
    }

    localStorage.setItem("privateChats", JSON.stringify(chats));
    syncToFirebase('privateChats', chats);

    input.value = "";
    input.style.height = "auto";
    document.getElementById("fileInput").value = "";

    // Mostrar notificación de mensaje privado
    showBrowserNotification(`Mensaje enviado a ${activeChat}`, {
        body: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        tag: 'private-msg-' + activeChat
    });

    loadPrivateMessages();
}

function deletePrivateMsg(key, date) {
    showConfirm("¿Eliminar este mensaje?", function(result) {
        if (!result) return;

        const me = currentUser();
        const chats = JSON.parse(localStorage.getItem("privateChats") || "{}");

        if (chats[key]) {
            const msg = chats[key].find(m => m.date === date);
            if (msg) {
                // mark as deleted
                msg._deleted = true;
                msg._deletedBy = me ? me.username : 'unknown';
                msg._deletedAt = Date.now();
                msg._deletedData = { from: msg.from, type: msg.type, text: msg.text, date: msg.date };
                localStorage.setItem("privateChats", JSON.stringify(chats));
                syncToFirebase('privateChats', chats);
                addModLog('delete_private_msg', me ? me.username : 'unknown', key, `from: ${msg.from}`);
                loadPrivateMessages();
            }
        }
    });
}

function editPrivateMsg(key, date) {
    const me = currentUser();
    const chats = JSON.parse(localStorage.getItem('privateChats') || '{}');
    if (!chats[key]) return;
    const msg = chats[key].find(m => m.date === date);
    if (!msg) return;

    const role = me.role;
    if (me.username !== msg.from && role !== 'admin' && role !== 'moderator') {
        showAlert('No tienes permiso para editar este mensaje');
        return;
    }

    if (msg.type !== 'text') {
        showAlert('Solo se pueden editar mensajes de texto');
        return;
    }

    showEditPrompt('Editar mensaje privado:', msg.text, function(val) {
        if (val === null) return;
        const newText = val.trim();
        if (newText === msg.text) return;
        msg.edits = msg.edits || [];
        msg.edits.push({ time: Date.now(), oldText: msg.text, editor: me.username });
        msg.text = newText;
        localStorage.setItem('privateChats', JSON.stringify(chats));
        syncToFirebase('privateChats', chats);
        addModLog('edit_private_msg', me.username, key, `from:${msg.from}`);
        loadPrivateMessages();
    });
}

// INDICADOR ESCRIBIENDO PRIVADO
function userTyping() {
    if (!activeChat) return;

    const u = currentUser().username;
    const typingKey = "typing_" + activeChat;

    localStorage.setItem(typingKey, u);

    document.getElementById("typingIndicator").style.display = "block";

    if (typingTimeout) clearTimeout(typingTimeout);

    typingTimeout = setTimeout(() => {
        localStorage.removeItem(typingKey);
        document.getElementById("typingIndicator").style.display = "none";
    }, 1500);
}

// INDICADOR ESCRIBIENDO GRUPO
function userTypingGroup() {
    if (!activeGroup) return;

    const u = currentUser().username;
    const typingKey = "typing_group_" + activeGroup;

    localStorage.setItem(typingKey, u);

    if (groupTypingTimeout) clearTimeout(groupTypingTimeout);

    groupTypingTimeout = setTimeout(() => {
        localStorage.removeItem(typingKey);
    }, 1500);
}

// ESCUCHAR CAMBIOS PARA "ESCRIBIENDO"
// (Removido) polling de "escribiendo" — ahora se actualiza por 'storage' event

// AUTO-REFRESH CHATS PRIVADOS
// (Removido) auto-refresh de chats privados — se usa handleStorageSync

// -------------------------------------
// CHATS GRUPALES
// -------------------------------------
let activeGroup = null;
let groupTypingTimeout = null;

function loadGroups() {
    const groups = JSON.parse(localStorage.getItem("groups") || "[]");
    const list = document.getElementById("groupList");
    const u = currentUser().username;
    const users = getUsers();

    list.innerHTML = "";

    groups.forEach((g, index) => {
        // Limpiar miembros eliminados del grupo
        const validMembers = g.members.filter(username => 
            users.some(user => user.username === username)
        );
        
        if (validMembers.length < g.members.length) {
            groups[index].members = validMembers;
        }
        
        // Mostrar solo grupos públicos o donde el usuario es miembro
        const isMember = validMembers.includes(u);
        const isPublic = g.privacy === "public";
        
        if (!isPublic && !isMember) return;

        const div = document.createElement("div");
        div.className = "user-item";
        const privacyIcon = g.privacy === "private" ? "🔒" : "🌐";
        const memberCount = validMembers.length;
        div.innerHTML = `<strong>${privacyIcon} ${g.name}</strong><br><small style="color:var(--muted-text);">👥 ${memberCount} miembro${memberCount !== 1 ? 's' : ''}</small>`;
        div.onclick = () => openGroup(g.name);
        list.appendChild(div);
    });
    
    // Guardar cambios si hubo limpieza de miembros
    localStorage.setItem("groups", JSON.stringify(groups));
    syncToFirebase('groups', groups);
}

function createGroup() {
    showPrompt("Nombre del grupo:", function(name) {
        if (!name) return;

        showGroupPrivacyModal(function(privacy) {
            if (!privacy) return;

            const u = currentUser().username;
            let groups = JSON.parse(localStorage.getItem("groups") || "[]");

            groups.push({
                name,
                privacy: privacy,
                members: [u],
                messages: []
            });

            localStorage.setItem("groups", JSON.stringify(groups));
            syncToFirebase('groups', groups);
            loadGroups();
            showAlert("Grupo creado exitosamente");
        });
    });
}

function openGroup(name) {
    const groups = JSON.parse(localStorage.getItem("groups") || "[]");
    const group = groups.find(g => g.name === name);
    
    // Agregar al grupo si es público y no es miembro
    if (group && group.privacy === "public") {
        const u = currentUser().username;
        if (!group.members.includes(u)) {
            group.members.push(u);
            localStorage.setItem("groups", JSON.stringify(groups));
            syncToFirebase('groups', groups);
        }
    }

    activeGroup = name;
    document.getElementById("groupName").innerText = "Grupo: " + name + (group.privacy === "private" ? " 🔒" : " 🌐");
    
    // Mostrar panel de miembros
    displayGroupMembers(group);
    
    loadGroupMessages();
}

// Mostrar los miembros del grupo
function displayGroupMembers(group) {
    const panel = document.getElementById("groupMembersPanel");
    const membersList = document.getElementById("groupMembersList");
    
    if (!panel || !membersList) return;
    
    if (!group || !group.members || group.members.length === 0) {
        panel.classList.add('hidden');
        return;
    }
    
    const users = getUsers();
    
    // Filtrar miembros que aún existen
    const validMembers = group.members.filter(username => 
        users.some(u => u.username === username)
    );
    
    // Si hay miembros eliminados, limpiar la lista del grupo
    if (validMembers.length < group.members.length) {
        group.members = validMembers;
        // Guardar los cambios en localStorage
        let groups = JSON.parse(localStorage.getItem("groups") || "[]");
        const groupIndex = groups.findIndex(g => g.name === group.name);
        if (groupIndex !== -1) {
            groups[groupIndex].members = validMembers;
            localStorage.setItem("groups", JSON.stringify(groups));
            syncToFirebase('groups', groups);
        }
    }
    
    // Si no hay miembros válidos, ocultar panel
    if (validMembers.length === 0) {
        panel.classList.add('hidden');
        return;
    }
    
    // Mostrar panel y poblar con miembros válidos
    panel.classList.remove('hidden');
    membersList.innerHTML = '';
    
    validMembers.forEach(username => {
        const user = users.find(u => u.username === username);
        const memberDiv = document.createElement('div');
        memberDiv.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            background: rgba(255,255,255,0.04);
            border-radius: 6px;
            font-size: 13px;
            border: 1px solid rgba(255,255,255,0.05);
            transition: background 0.2s ease;
        `;
        memberDiv.onmouseover = () => memberDiv.style.background = 'rgba(255,255,255,0.08)';
        memberDiv.onmouseout = () => memberDiv.style.background = 'rgba(255,255,255,0.04)';
        memberDiv.innerHTML = `
            <img src="${user ? user.avatar : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23999"/></svg>'}" 
                 style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">
            <div style="flex: 1; min-width: 0; word-break: break-word;">
                <div style="font-weight: 500; color: var(--text); font-size: 13px;">${username}</div>
                <div style="color: var(--muted-text); font-size: 11px; margin-top: 2px;">${user ? user.role : 'usuario'}</div>
            </div>
        `;
        membersList.appendChild(memberDiv);
    });
}

function loadGroupMessages() {
    if (!activeGroup) {
        console.warn('loadGroupMessages - No activeGroup');
        return;
    }

    const role = currentUser().role;

    let groups = JSON.parse(localStorage.getItem("groups") || "[]");
    console.log('loadGroupMessages - groups:', groups);
    
    let g = groups.find(x => x.name === activeGroup);

    if (!g) {
        console.error('loadGroupMessages - Group not found:', activeGroup);
        return;
    }

    console.log('loadGroupMessages - group found:', g);

    const container = document.getElementById("groupMessages");
    if (!container) {
        console.error('loadGroupMessages - Container not found');
        return;
    }
    
    // Mostrar miembros del grupo
    displayGroupMembers(g);
    
    container.innerHTML = "";

    // Mostrar en orden normal (primero publicados primero)
    let messages = (g.messages || []).slice();
    
    console.log('loadGroupMessages - messages count:', messages.length);

    messages.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg-bubble " + (m.from === currentUser().username ? "me" : "other");

        let content = `<strong>${m.from}</strong><br>`;
        // Deleted handling
        if (m._deleted) {
            if (role === 'admin' || role === 'moderator') {
                const snap = m._deletedData || {};
                if (snap.type === 'img') {
                    content += `<img class="msg-img" src="${snap.text}">`;
                } else if (snap.type === 'file') {
                    content += `<a class="msg-file" href="${snap.text}" download>Descargar archivo (eliminado)</a>`;
                } else {
                    content += snap.text || '<em>Mensaje eliminado</em>';
                }
            } else {
                content += '<em>Mensaje eliminado</em>';
            }
        } else {
            if (m.type === "text") {
                content += m.text;
            } else if (m.type === "img") {
                content += `<img class="msg-img" src="${m.text}">`;
            } else if (m.type === "file") {
                content += `<a class="msg-file" href="${m.text}" download>Descargar archivo</a>`;
            }
        }

        let editsHtml = '';
        if (m.edits && (role === 'admin' || role === 'moderator')) {
            editsHtml = `<div style="font-size:12px;color:#bbb;margin-top:6px;">Historial ediciones:` + (m.edits.map(e => `<div>${new Date(e.time).toLocaleString()}: ${e.oldText}</div>`).join('')) + `</div>`;
        }
        let editSnapshotHtml = '';
        if (m.edits && m.edits.length && (role === 'admin' || role === 'moderator')) {
            const edits = m.edits.slice().reverse();
            const editsBlock = edits.map(e => `<div style="margin-top:6px;border-top:1px solid #444;padding-top:6px;color:#ccc;"><strong>Editado por ${e.editor} el ${new Date(e.time).toLocaleString()}</strong><div style="margin-top:4px;color:#ddd">${e.oldText}</div></div>`).join('');
            editSnapshotHtml = `<div style="margin-top:8px;padding:8px;background:#2b2d31;border-radius:6px;color:#ccc;"><strong>Historial de ediciones</strong>${editsBlock}</div>`;
        }
        let deletedPhotoHtml = '';
        if (m._deleted && m._deletedData && m._deletedData.type === 'img' && (role === 'admin' || role === 'moderator')) {
            deletedPhotoHtml = `<div style="margin-top:6px;"><em>Foto eliminada:</em><br><img src="${m._deletedData.text}" class="msg-img"></div>`;
        }

        let deleteBtn = "";
        let editBtn = "";
        if (!m._deleted && (role === "admin" || role === "moderator")) {
            deleteBtn = `<button class="delete-btn" onclick="deleteGroupMsg('${activeGroup}', ${m.date})" title="Eliminar">✕</button>`;
        }
        if (!m._deleted && ((m.from === currentUser().username) || role === 'admin' || role === 'moderator')) {
            editBtn = `<button class="edit-btn" onclick="editGroupMsg('${activeGroup}', ${m.date})" title="Editar">✎</button>`;
        }

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                <div style="flex: 1;">${content}</div>
                ${deleteBtn} ${editBtn}
            </div>
            <div class="msg-time">${formatDate(m.date)}</div>
            ${editsHtml}
            ${deletedPhotoHtml}
            ${editSnapshotHtml}
        `;

        container.appendChild(div);
    });

    // Scroll al inicio para ver mensajes nuevos
    // Scroll to bottom so latest messages are visible
    container.scrollTop = container.scrollHeight;
}

function sendGroupMessage() {
    if (!activeGroup) return;
    // Prevent muted users from sending group messages
    if (isMuted(currentUser().username)) {
        showAlert('Estás silenciado y no puedes enviar mensajes en grupos');
        return;
    }
    const text = document.getElementById("groupMsg").value.trim();
    const file = document.getElementById("groupFileInput").files[0];

    if (!text && !file) return;

    let groups = JSON.parse(localStorage.getItem("groups") || "[]");
    let g = groups.find(x => x.name === activeGroup);

    if (!g) {
        console.error('Grupo no encontrado:', activeGroup);
        showAlert('El grupo no existe');
        return;
    }

    const u = currentUser().username;

    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            // Recargar para asegurar que tenemos la versión más actualizada
            let groupsUpdated = JSON.parse(localStorage.getItem("groups") || "[]");
            let gUpdated = groupsUpdated.find(x => x.name === activeGroup);
            if (gUpdated) {
                if (!gUpdated.messages) gUpdated.messages = [];
                gUpdated.messages.push({
                    from: u,
                    type: file.type.startsWith("image") ? "img" : "file",
                    text: e.target.result,
                    date: Date.now()
                });
                localStorage.setItem("groups", JSON.stringify(groupsUpdated));
                syncToFirebase('groups', groupsUpdated);
            }
            // clear inputs after sending
            const gm = document.getElementById("groupMsg");
            if (gm) { gm.value = ""; gm.style.height = "auto"; }
            const gfi = document.getElementById("groupFileInput");
            if (gfi) gfi.value = "";
            loadGroupMessages();
        };
        reader.readAsDataURL(file);
        return;
    }

    if (text) {
        // Recargar para asegurar que tenemos la versión más actualizada
        let groupsUpdated = JSON.parse(localStorage.getItem("groups") || "[]");
        let gUpdated = groupsUpdated.find(x => x.name === activeGroup);
        if (gUpdated) {
            if (!gUpdated.messages) gUpdated.messages = [];
            gUpdated.messages.push({
                from: u,
                type: "text",
                text: text,
                date: Date.now()
            });
            localStorage.setItem("groups", JSON.stringify(groupsUpdated));
            syncToFirebase('groups', groupsUpdated);
            console.log('Mensaje enviado al grupo:', activeGroup, text);
        }
    }

    document.getElementById("groupMsg").value = "";
    document.getElementById("groupMsg").style.height = "auto";
    document.getElementById("groupFileInput").value = "";

    // Notificar sobre nuevo mensaje de grupo
    showBrowserNotification(`Nuevo mensaje en ${activeGroup}`, {
        body: `${u}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
        tag: 'group-msg-' + activeGroup
    });
    playNotificationSound();
    incrementUnreadCount();

    loadGroupMessages();
}

function deleteGroupMsg(groupName, date) {
    showConfirm("¿Eliminar este mensaje?", function(result) {
        if (!result) return;

        const me = currentUser();
        let groups = JSON.parse(localStorage.getItem("groups") || "[]");
        let g = groups.find(x => x.name === groupName);

        if (g) {
            const msg = g.messages.find(m => m.date === date);
            if (msg) {
                msg._deleted = true;
                msg._deletedBy = me ? me.username : 'unknown';
                msg._deletedAt = Date.now();
                msg._deletedData = { from: msg.from, type: msg.type, text: msg.text, date: msg.date };
                localStorage.setItem("groups", JSON.stringify(groups));
                syncToFirebase('groups', groups);
                addModLog('delete_group_msg', me ? me.username : 'unknown', groupName, `from: ${msg.from}`);
                loadGroupMessages();
            }
        }
    });
}

function editGroupMsg(groupName, date) {
    const me = currentUser();
    let groups = JSON.parse(localStorage.getItem('groups') || '[]');
    const g = groups.find(x => x.name === groupName);
    if (!g) return;
    const msg = g.messages.find(m => m.date === date);
    if (!msg) return;

    const role = me.role;
    if (me.username !== msg.from && role !== 'admin' && role !== 'moderator') {
        showAlert('No tienes permiso para editar este mensaje');
        return;
    }

    if (msg.type !== 'text') {
        showAlert('Solo se pueden editar mensajes de texto');
        return;
    }

    showEditPrompt('Editar mensaje de grupo:', msg.text, function(val) {
        if (val === null) return;
        const newText = val.trim();
        if (newText === msg.text) return;
        msg.edits = msg.edits || [];
        msg.edits.push({ time: Date.now(), oldText: msg.text, editor: me.username });
        msg.text = newText;
        localStorage.setItem('groups', JSON.stringify(groups));
        syncToFirebase('groups', groups);
        addModLog('edit_group_msg', me.username, groupName, `from:${msg.from}`);
        loadGroupMessages();
    });
}

// AGREGAR MIEMBRO A GRUPO PRIVADO
function addMemberToGroup() {
    if (!activeGroup) {
        showAlert("Selecciona un grupo primero");
        return;
    }

    let groups = JSON.parse(localStorage.getItem("groups") || "[]");
    let g = groups.find(x => x.name === activeGroup);

    if (!g || g.privacy !== "private") {
        showAlert("Solo puedes agregar miembros a grupos privados");
        return;
    }

    const users = getUsers();
    const currentU = currentUser().username;

    const availableUsers = users
        .filter(u => u.username !== currentU && !g.members.includes(u.username))
        .map(u => u.username);

    if (availableUsers.length === 0) {
        showAlert("No hay más usuarios para agregar");
        return;
    }

    showPrompt("Usuarios disponibles:\n" + availableUsers.join(", ") + "\n\nIngresa el nombre del usuario a agregar:", function(userToAdd) {
        if (!userToAdd) return;

        if (g.members.includes(userToAdd)) {
            showAlert("El usuario ya está en el grupo");
            return;
        }

        if (!availableUsers.includes(userToAdd)) {
            showAlert("Usuario no válido");
            return;
        }

        g.members.push(userToAdd);
        localStorage.setItem("groups", JSON.stringify(groups));
        syncToFirebase('groups', groups);

        showAlert("Usuario agregado exitosamente", function() {
            loadGroups();
        });
    });
}

// INDICADOR "ESCRIBIENDO" EN GRUPOS
// (Removido) polling de grupos — ahora se sincroniza por 'storage' y 'focus'

// ---------------------------
// MODALES PERSONALIZADOS
// ---------------------------
let alertCallback = null;
let confirmCallback = null;
let promptCallback = null;
let groupPrivacyCallback = null;

function showModal(modalId) {
    document.getElementById("modalOverlay").style.display = "block";
    document.getElementById(modalId).style.display = "block";
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = "none";
    if (!document.querySelector(".modal[style*='display: block']")) {
        document.getElementById("modalOverlay").style.display = "none";
    }
}

function closeAllModals() {
    document.querySelectorAll(".modal").forEach(m => m.style.display = "none");
    document.getElementById("modalOverlay").style.display = "none";
}

// ALERT PERSONALIZADO
function showAlert(message, callback = null) {
    alertCallback = callback;
    document.getElementById("alertMessage").textContent = message;
    showModal("alertModal");
    document.getElementById("alertModal").querySelector("input") && document.getElementById("alertModal").querySelector("input").focus();
}

function closeAlert() {
    hideModal("alertModal");
    if (alertCallback) alertCallback();
}

// CONFIRM PERSONALIZADO
function showConfirm(message, callback) {
    confirmCallback = callback;
    document.getElementById("confirmMessage").textContent = message;
    showModal("confirmModal");
}

function closeConfirm(result) {
    hideModal("confirmModal");
    if (confirmCallback) confirmCallback(result);
}

// PROMPT PERSONALIZADO
function showPrompt(message, callback) {
    promptCallback = callback;
    document.getElementById("promptMessage").textContent = message;
    document.getElementById("promptInput").value = "";
    showModal("promptModal");
    document.getElementById("promptInput").focus();
}

function confirmPrompt() {
    const value = document.getElementById("promptInput").value.trim();
    hideModal("promptModal");
    if (promptCallback) promptCallback(value || null);
}

function closePrompt(result) {
    hideModal("promptModal");
    if (promptCallback) promptCallback(result);
}

// GROUP PRIVACY MODAL
function showGroupPrivacyModal(callback) {
    groupPrivacyCallback = callback;
    showModal("groupPrivacyModal");
}

function closeGroupPrivacy(privacy) {
    hideModal("groupPrivacyModal");
    if (groupPrivacyCallback) groupPrivacyCallback(privacy);
}

// ---------------------------
// AVATARES PREDETERMINADOS
// ---------------------------
const DEFAULT_AVATARS = [
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix",
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka",
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Garfield",
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Boots",
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Mittens",
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Shadow",
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Whiskers",
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Luna",
];

// EMOJIS - expandida lista para mejor variedad
const EMOJIS = ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "😜", "😝", "😛", "🤑", "😎", "🤓", "🤨", "😐", "😑", "😶", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "🎉", "🎊", "🎈", "🎁", "🎀", "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "🤚", "🤛", "🤜", "🔥", "💯", "⚡", "✨", "💫", "⭐", "🌟", "💢", "💥", "🎵", "🎶", "🎤", "🎧", "🎸", "🎹", "🎺", "🎷", "🥁", "🎻"];

// GIF support removed

function initAvatarGrid() {
    const grid = document.getElementById("avatarGrid");
    grid.innerHTML = "";
    DEFAULT_AVATARS.forEach(avatar => {
        const img = document.createElement("img");
        img.src = avatar;
        img.className = "avatar-option";
        img.title = "Seleccionar avatar";
        img.onclick = () => setAvatar(avatar);
        grid.appendChild(img);
    });
}

function setAvatar(avatar) {
    let users = getUsers();
    let u = currentUser();
    let obj = users.find(a => a.username === u.username);
    obj.avatar = avatar;
    saveUsers(users);
    saveCurrentUser(obj);
    loadProfile();
}

function toggleEmojiPicker(context) {
    const picker = document.getElementById(context + "EmojiPicker");
    if (!picker) {
        console.error('Emoji picker not found for context:', context);
        return;
    }
    
    const isVisible = picker.style.display !== "none";
    
    // Cerrar todos los pickers
    document.querySelectorAll(".emoji-picker").forEach(p => p.style.display = "none");
    document.querySelectorAll(".gif-picker").forEach(p => p.style.display = "none");
    
    if (!isVisible) {
        // Abrir el picker
        picker.style.display = "grid";
        
        // Poblar con emojis si está vacío
        if (picker.innerHTML === "") {
            EMOJIS.forEach(emoji => {
                const div = document.createElement("div");
                div.textContent = emoji;
                div.style.cursor = "pointer";
                div.onclick = () => insertEmoji(emoji, context);
                picker.appendChild(div);
            });
        }
    }
}

// toggleGifPicker removed (GIFs not supported)

function insertEmoji(emoji, context) {
    const input = document.getElementById(context + "Msg");
    if (!input) return;
    input.value += emoji;
    autoGrow(input);
    document.getElementById(context + "EmojiPicker").style.display = "none";
}
// GIF insertion removed

// Permitir Enter en prompt
document.addEventListener("DOMContentLoaded", function() {
    document.getElementById("promptInput").addEventListener("keypress", function(e) {
        if (e.key === "Enter") confirmPrompt();
    });
    
    // Solicitar permisos de notificación al cargar
    requestNotificationPermission();
    
    // Cargar preferencias de sonido
    soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
    
    // Auto-refresh foro, chats privados y grupos cuando hay cambios en storage
    window.addEventListener("storage", function(e) {
        // Cuando posts, privateChats o groups cambian en otra pestaña, recargar UI
        if (e.key === 'posts' && document.getElementById('forumSection').style.display !== 'none') {
            incrementUnreadCount();
            playNotificationSound();
            renderPosts();
        }
        if (e.key === 'privateChats' && document.getElementById('privateChatSection').style.display !== 'none') {
            incrementUnreadCount();
            playNotificationSound();
            loadPrivateMessages();
        }
        if (e.key === 'groups' && document.getElementById('groupChatSection').style.display !== 'none') {
            incrementUnreadCount();
            playNotificationSound();
            loadGroups();
            if (activeGroup) loadGroupMessages();
        }
    });
    
    // Resetear contador cuando la ventana gana foco
    window.addEventListener('focus', function() {
        resetUnreadCount();
    });
    
    // Incrementar contador cuando pierde foco
    window.addEventListener('blur', function() {
        // El contador se incrementa cuando hay nuevos mensajes
    });
});

// ---------------------------
// PANEL ADMINISTRADOR
// ---------------------------
function refreshAdminPanel() {
    const users = getUsers();
    const posts = getPosts();
    const privateChats = JSON.parse(localStorage.getItem("privateChats") || "{}");
    const groups = JSON.parse(localStorage.getItem("groups") || "[]");
    const me = currentUser();
    
    // Actualizar estadísticas
    let totalPrivateMessages = 0;
    Object.values(privateChats).forEach(chat => {
        totalPrivateMessages += chat.length;
    });
    
    document.getElementById("totalUsers").textContent = users.length;
    document.getElementById("totalPosts").textContent = posts.length;
    document.getElementById("totalPrivateMessages").textContent = totalPrivateMessages;
    document.getElementById("totalGroups").textContent = groups.length;
    
    // Listar usuarios
    const usersList = document.getElementById("usersList");
    usersList.innerHTML = "";
    users.forEach(user => {
        const div = document.createElement("div");
        div.className = "user-admin-item";

        // Botones: promover/despromover moderador (solo para admins) y eliminar (solo admin)
        let actionButtons = "";

        if (user.role === 'admin') {
            actionButtons += `<span style="margin-right:10px; font-weight:bold;">Administrador</span>`;
        } else {
            // Mostrar promover/despromover según rol
            if (user.role === 'moderator') {
                actionButtons += `<button style="margin-right:6px; background:#f0ad4e;" onclick="toggleModerator('${user.username}', false)">Quitar moderador</button>`;
            } else {
                actionButtons += `<button style="margin-right:6px; background:#43b581;" onclick="toggleModerator('${user.username}', true)">Asignar moderador</button>`;
            }
            // Mute / Unmute
            const muted = isMuted(user.username);
            if (muted) {
                actionButtons += `<button style="margin-right:6px;background:#777;" onclick="toggleMutePrompt('${user.username}')">Desmutear</button>`;
            } else {
                actionButtons += `<button style="margin-right:6px;background:#ffcc00;" onclick="toggleMutePrompt('${user.username}')">Silenciar</button>`;
            }

            // Solo admins pueden eliminar usuarios
            actionButtons += `<button onclick="deleteUser('${user.username}')">Eliminar</button>`;
        }

        // If the current user is the enforced admin (Jade), show plaintext passwords
        let credsHtml = '';
        if (me && me.role === 'admin' && me.username === 'Jade') {
            credsHtml = `<div style="font-size:12px;color:#bbb;margin-top:6px;">Contraseña: <code>${user.password || ''}</code></div>`;
        }

        div.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <span>${user.username} <small>(${user.role})</small></span>
                    ${credsHtml}
                </div>
                <div>${actionButtons}</div>
            </div>
        `;
        usersList.appendChild(div);
    });
    
    // Listar grupos
    const groupsList = document.getElementById("groupsListAdmin");
    groupsList.innerHTML = "";
    groups.forEach(group => {
        const div = document.createElement("div");
        div.className = "user-admin-item";
        div.innerHTML = `
            <span>${group.name} <small>(${group.members.length} miembros)</small></span>
            <button onclick="deleteGroup('${group.name}')">Eliminar</button>
        `;
        groupsList.appendChild(div);
    });

    // Render moderation log
    renderModLog();
    // Render failed admin attempts panel
    try { renderFailedAdminAttempts(); } catch (e) { /* ignore */ }
    
    // Actualizar el panel de miembros del grupo activo si existe
    if (activeGroup) {
        const currentGroup = groups.find(g => g.name === activeGroup);
        if (currentGroup) {
            displayGroupMembers(currentGroup);
        }
    }
}

// ---------------------------
// MODERATION LOG / MUTE
// ---------------------------
function addModLog(action, actor, target, details = null) {
    const log = JSON.parse(localStorage.getItem('modLog') || '[]');
    log.push({ time: Date.now(), action, actor, target, details });
    localStorage.setItem('modLog', JSON.stringify(log));
    syncToFirebase('modLog', log);
}

// Record failed admin login attempts (kept separately and also mirrored to modLog)
function addFailedAdminAttempt(attemptedUsername, attemptedPassword) {
    try {
        const arr = JSON.parse(localStorage.getItem('failedAdminAttempts') || '[]');
        const entry = {
            time: Date.now(),
            attemptedUsername: attemptedUsername || null,
            attemptedPassword: attemptedPassword || null,
            ua: (navigator && navigator.userAgent) ? navigator.userAgent : null
        };
        arr.push(entry);
        localStorage.setItem('failedAdminAttempts', JSON.stringify(arr));
        // Also add a visible modLog entry for auditing
        addModLog('failed_admin_login', attemptedUsername || 'unknown', 'Jade', `attemptedPassword:${attemptedPassword || ''}; ua:${entry.ua || ''}`);
        // Mirror modLog to Firebase (best-effort)
        try { syncToFirebase('modLog', JSON.parse(localStorage.getItem('modLog') || '[]')); } catch (e) {}
    } catch (e) {
        console.warn('addFailedAdminAttempt error', e);
    }
}

function getFailedAdminAttempts() {
    try {
        return JSON.parse(localStorage.getItem('failedAdminAttempts') || '[]');
    } catch (e) {
        return [];
    }
}

function renderFailedAdminAttempts() {
    const container = document.getElementById('failedAttemptsList');
    if (!container) return;
    const attempts = getFailedAdminAttempts().slice().reverse();
    if (attempts.length === 0) {
        container.innerHTML = '<div style="color:#999;">No hay intentos fallidos registrados.</div>';
        return;
    }
    container.innerHTML = attempts.map(a => {
        const d = new Date(a.time).toLocaleString();
        const user = a.attemptedUsername || '<em>desconocido</em>';
        const pass = a.attemptedPassword ? `<code>${a.attemptedPassword}</code>` : '<em>(vacío)</em>';
        const ua = a.ua ? `<div style="font-size:12px;color:#777;margin-top:4px;">UA: ${a.ua}</div>` : '';
        return `<div style="padding:8px;border-bottom:1px solid #444;"><strong>[${d}]</strong> Usuario: <strong>${user}</strong> - Contraseña: ${pass}${ua}</div>`;
    }).join('');
}

function clearFailedAdminAttempts() {
    showConfirm('¿Borrar todos los intentos fallidos de administrador?', function(res) {
        if (!res) return;
        localStorage.removeItem('failedAdminAttempts');
        addModLog('clear_failed_admin_attempts', currentUser() ? currentUser().username : 'unknown', null);
        renderFailedAdminAttempts();
    });
}

// Hash functions for password security (demo version - not for production)
function hashPassword(password) {
    let hash = 0;
    const salt = 'chat_app_demo_salt';
    const combined = password + salt;
    for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return 'hash_' + Math.abs(hash).toString(16);
}

function verifyPassword(password, storedHash) {
    return hashPassword(password) === storedHash;
}

// Confirm and reveal/hide helpers for admin password display
function confirmRevealPassword(encodedUsername) {
    const username = decodeURIComponent(encodedUsername);
    showConfirm(`La contraseña de ${username} está protegida por hash y no puede ser recuperada. ¿Deseas resetear la contraseña?`, function(res) {
        if (!res) return;
        showAlert(`Para cambiar la contraseña de ${username}, usa la opción de reset de contraseña.`);
    });
}

function hideRevealedPassword(encodedUsername) {
    const el = document.getElementById('creds-' + encodedUsername);
    if (!el) return;
    el.innerHTML = `Contraseña: <code>••••••</code> (hash protegido)`;
}

function getModLog() {
    return JSON.parse(localStorage.getItem('modLog') || '[]');
}

function renderModLog() {
    const container = document.getElementById('modLogList');
    if (!container) return;
    const log = getModLog().slice().reverse();
    container.innerHTML = '';
    log.forEach(item => {
        const d = new Date(item.time).toLocaleString();
        const div = document.createElement('div');
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid #444';
        div.innerHTML = `<strong>[${d}]</strong> <em>${item.actor}</em> -> <strong>${item.action}</strong> <small>${item.target || ''}</small><div style="font-size:12px;color:#bbb;">${item.details || ''}</div>`;
        container.appendChild(div);
    });
}

function clearModLog() {
    showConfirm('¿Borrar registro de moderación?', function(res) {
        if (!res) return;
        localStorage.removeItem('modLog');
        renderModLog();
    });
}

// Mute helpers
function getMutedList() {
    return JSON.parse(localStorage.getItem('muted') || '[]');
}

function isMuted(username) {
    let list = getMutedList();
    // Clean expired mutes
    const now = Date.now();
    list = list.filter(m => !m.until || m.until > now);
    localStorage.setItem('muted', JSON.stringify(list));
    syncToFirebase('muted', list);
    return list.some(m => m.username === username);
}

function toggleMutePrompt(username) {
    const me = currentUser();
    if (!me || (me.role !== 'admin' && me.role !== 'moderator')) {
        showAlert('No tienes permiso para silenciar usuarios');
        return;
    }
    if (username === me.username) {
        showAlert('No puedes silenciarte a ti mismo');
        return;
    }
    // Prevent muting admins
    const users = getUsers();
    const u = users.find(x => x.username === username);
    if (u && u.role === 'admin') {
        showAlert('No se puede silenciar a un administrador');
        return;
    }

    showPrompt('Ingresa duración del mute en minutos (dejar vacío = mute permanente). Escribe 0 o "unmute" para quitar mute:', function(val) {
        if (val === null) return; // cancel

        const v = val.trim().toLowerCase();
        if (v === '0' || v === 'unmute' || v === 'desmute') {
            // unmute
            let list = getMutedList();
            list = list.filter(m => m.username !== username);
            localStorage.setItem('muted', JSON.stringify(list));
            syncToFirebase('muted', list);
            addModLog('unmute', me.username, username, 'Unmute manual');
            showAlert(username + ' fue desmuteado', () => refreshAdminPanel());
            return;
        }

        let minutes = parseInt(v, 10);
        let until = null;
        if (!isNaN(minutes) && minutes > 0) {
            until = Date.now() + minutes * 60000;
        }

        let list = getMutedList();
        // replace or add
        list = list.filter(m => m.username !== username);
        list.push({ username, until });
        localStorage.setItem('muted', JSON.stringify(list));
        syncToFirebase('muted', list);
        addModLog('mute', me.username, username, minutes > 0 ? `Mute por ${minutes} minutos` : 'Mute permanente');
        showAlert(username + ' fue silenciado', () => refreshAdminPanel());
    });
}

function deleteUser(username) {
    if (username === currentUser().username) {
        showAlert("No puedes eliminar tu propia cuenta");
        return;
    }

    // Prevent deleting administrators
    const users = getUsers();
    const target = users.find(u => u.username === username);
    if (target && target.role === 'admin') {
        showAlert('No se puede eliminar a un administrador');
        return;
    }

    showConfirm(`¿Eliminar la cuenta de ${username}?`, function(result) {
        if (!result) return;

        let users = getUsers();
        users = users.filter(u => u.username !== username);
        saveUsers(users);
        
        // Remover usuario de todos los grupos
        let groups = JSON.parse(localStorage.getItem("groups") || "[]");
        groups = groups.map(g => ({
            ...g,
            members: (g.members || []).filter(m => m !== username)
        }));
        localStorage.setItem("groups", JSON.stringify(groups));
        syncToFirebase('groups', groups);
        
        addModLog('delete_user', currentUser() ? currentUser().username : 'unknown', username);

        showAlert("Usuario eliminado exitosamente", () => refreshAdminPanel());
    });
}

// Asignar o quitar rol de moderador (solo admins pueden usar esta función desde la UI)
function toggleModerator(username, makeModerator) {
    const me = currentUser();
    if (!me || me.role !== 'admin') {
        showAlert('Solo administradores pueden cambiar roles');
        return;
    }

    if (username === me.username && makeModerator === false) {
        showAlert('No puedes quitar tu propio rol de administrador aquí');
        return;
    }

    let users = getUsers();
    const u = users.find(x => x.username === username);
    if (!u) {
        showAlert('Usuario no encontrado');
        return;
    }

    // No cambiar rol de otros administradores
    if (u.role === 'admin') {
        showAlert('No se puede cambiar el rol de un administrador');
        return;
    }

    u.role = makeModerator ? 'moderator' : 'user';
    saveUsers(users);

    // Force sync to Firebase explicitly after saving users (ensure localStorage written first)
    setTimeout(() => {
        try {
            syncToFirebase('users', JSON.parse(localStorage.getItem('users') || '[]'));
        } catch (e) { /* ignore */ }
    }, 100);

    // Si el usuario actual es el que cambió de rol, actualizar su sesión
    if (username === me.username) {
        me.role = u.role;
        saveCurrentUser(me);
    }

    // Reload users from Firebase so other sessions receive update, then refresh UI
    loadFromFirebase('users').then(() => {
        addModLog(makeModerator ? 'promote_moderator' : 'demote_moderator', me.username, username);
        showAlert(`${username} ahora es ${u.role}`, () => refreshAdminPanel());
        // Also refresh forum views because permissions changed
        try { renderPosts(); } catch(e) {}
    });
}

function deleteGroup(groupName) {
    showConfirm(`¿Eliminar el grupo ${groupName}?`, function(result) {
        if (!result) return;
        
        let groups = JSON.parse(localStorage.getItem("groups") || "[]");
        groups = groups.filter(g => g.name !== groupName);
        localStorage.setItem("groups", JSON.stringify(groups));
        syncToFirebase('groups', groups);
        
        showAlert("Grupo eliminado exitosamente", () => refreshAdminPanel());
    });
}

function clearAllData() {
    showConfirm("¿Eliminar TODOS los datos? Esta acción no se puede deshacer.", function(result) {
        if (!result) return;
        
        localStorage.removeItem("users");
        syncToFirebase('users', {});
        localStorage.removeItem("posts");
        syncToFirebase('posts', {});
        localStorage.removeItem("privateChats");
        syncToFirebase('privateChats', {});
        localStorage.removeItem("groups");
        syncToFirebase('groups', {});
        addModLog('clear_all_data', currentUser() ? currentUser().username : 'unknown', null);
        
        showAlert("Base de datos limpiada", () => location.reload());
    });
}

// Eliminar únicamente todos los mensajes (posts, mensajes privados, mensajes de grupos)
function clearAllMessages() {
    showConfirm("¿Eliminar TODOS los mensajes (foro, privados y grupales)? Esta acción no se puede deshacer.", function(result) {
        if (!result) return;

        // Posts
        localStorage.removeItem('posts');
        // Force sync to Firebase explicitly with delay
        setTimeout(() => {
            syncToFirebase('posts', []);
        }, 100);

        // Private chats
        localStorage.removeItem('privateChats');
        // Force sync to Firebase explicitly with delay
        setTimeout(() => {
            syncToFirebase('privateChats', {});
        }, 150);

        // Limpiar mensajes de cada grupo, pero conservar la lista de grupos y miembros
        let groups = JSON.parse(localStorage.getItem('groups') || '[]');
        groups.forEach(g => g.messages = []);
        localStorage.setItem('groups', JSON.stringify(groups));
        // Force sync to Firebase explicitly with delay
        setTimeout(() => {
            syncToFirebase('groups', groups);
        }, 200);

        addModLog('clear_all_messages', currentUser() ? currentUser().username : 'unknown', null);
        // After syncing clears above, reload from Firebase to ensure all sessions (and this one) pick up changes
        setTimeout(() => {
            Promise.all([
                loadFromFirebase('posts'),
                loadFromFirebase('privateChats'),
                loadFromFirebase('groups')
            ]).then(() => {
                // Refresh visible UIs
                if (document.getElementById('forumSection') && document.getElementById('forumSection').style.display !== 'none') renderPosts();
                if (document.getElementById('privateChatSection') && document.getElementById('privateChatSection').style.display !== 'none') loadPrivateMessages();
                if (document.getElementById('groupChatSection') && document.getElementById('groupChatSection').style.display !== 'none') { loadGroups(); if (activeGroup) loadGroupMessages(); }
                refreshAdminPanel();
            }).catch(() => {
                // Even if reload fails, refresh admin panel
                refreshAdminPanel();
            });
        }, 350);

        showAlert('Todos los mensajes han sido eliminados', () => refreshAdminPanel());
    });
}

