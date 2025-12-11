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
// DEVICE DETECTION
// ---------------------------
// Detect if user is on mobile device
const isMobileDevice = () => {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    // Check viewport width
    if (window.innerWidth <= 768) return true;
    // Check user agent for common mobile patterns
    return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua.toLowerCase());
};

const isMobile = isMobileDevice();

// Apply mobile-specific enhancements
function enhanceMobileUX() {
    if (!isMobile) return;

    // Add haptic feedback for button clicks
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('button');
        if (btn && navigator.vibrate) {
            navigator.vibrate(10);
        }
    }, true);

    // Improve scroll behavior
    const scrollElements = document.querySelectorAll('.chat-messages, #groupMessages, .user-list, .group-list');
    scrollElements.forEach(el => {
        if (el) {
            el.style.WebkitOverflowScrolling = 'touch';
        }
    });

    // Prevent pinch zoom on input focus (some browsers)
    document.addEventListener('touchmove', function(e) {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });
}

// Apply mobile-specific styles
function applyMobileStyles() {
    if (isMobile) {
        document.documentElement.setAttribute('data-device', 'mobile');
        document.body.style.fontSize = '14px';
        enhanceMobileUX();
    } else {
        document.documentElement.setAttribute('data-device', 'desktop');
    }
}

// ---------------------------
// ---------------------------
let notificationEnabled = false;
let soundEnabled = true;
let unreadCount = 0;
let forumSortType = localStorage.getItem('forumSortType') || 'recent';
let allPosts = []; // Para filtrado del foro
let allPrivateChats = []; // Para filtrado de privados
let allGroupMessages = []; // Para filtrado de grupos

// Almacenar contenido de textareas para preservarlos durante renders
let textareaStates = {
    forumMsg: '',
    privateMsg: '',
    groupMsg: ''
};

function saveTextareaStates() {
    const forumMsg = document.getElementById('forumMsg');
    const privateMsg = document.getElementById('privateMsg');
    const groupMsg = document.getElementById('groupMsg');
    
    if (forumMsg) textareaStates.forumMsg = forumMsg.value;
    if (privateMsg) textareaStates.privateMsg = privateMsg.value;
    if (groupMsg) textareaStates.groupMsg = groupMsg.value;
}

function restoreTextareaStates() {
    const forumMsg = document.getElementById('forumMsg');
    const privateMsg = document.getElementById('privateMsg');
    const groupMsg = document.getElementById('groupMsg');
    
    if (forumMsg && textareaStates.forumMsg) forumMsg.value = textareaStates.forumMsg;
    if (privateMsg && textareaStates.privateMsg) privateMsg.value = textareaStates.privateMsg;
    if (groupMsg && textareaStates.groupMsg) groupMsg.value = textareaStates.groupMsg;
}

function checkExistingSession() {
    // Verificar si hay un usuario guardado en localStorage
    const savedUser = currentUser();
    if (savedUser) {
        // Usuario existe, mostrar el chat directamente
        updateAdminNavVisibility();
        // Actualizar actividad inmediatamente al restaurar sesión
        updateUserActivity();
        initFirebaseListeners();
        // Apply mobile styles after DOM is ready
        applyMobileStyles();
        showSection('forumSection');
        return true;
    }
    return false;
}

// Solicitar permiso de notificaciones al iniciar
function requestNotificationPermission() {
    // Solo solicitar si no hemos preguntado antes
    if ('Notification' in window && Notification.permission === 'default') {
        const hasAskedBefore = localStorage.getItem('notificationPermissionAsked');
        // Solo solicitar una vez, no en cada carga
        if (!hasAskedBefore) {
            Notification.requestPermission().then(permission => {
                localStorage.setItem('notificationPermissionAsked', 'true');
                if (permission === 'granted') {
                    notificationEnabled = true;
                    localStorage.setItem('notificationsEnabled', 'true');
                }
            });
        }
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

// Actualizar badges en la barra de navegación (Privados / Grupos / Foro)
function updateNavUnreadIndicators() {
    const meObj = currentUser();
    if (!meObj) return;
    const me = meObj.username;

    // Private chats
    let privTotal = 0;
    try {
        const privateChats = JSON.parse(localStorage.getItem('privateChats') || '{}');
        Object.values(privateChats).forEach(chat => {
            if (chat && chat.unread && chat.unread[me]) privTotal += Number(chat.unread[me]) || 0;
        });
    } catch (e) {}

    const privBadge = document.getElementById('navBadgePriv');
    if (privBadge) {
        if (privTotal > 0) { privBadge.style.display = 'inline-block'; privBadge.textContent = privTotal; }
        else { privBadge.style.display = 'none'; }
    }

    // Groups
    let groupTotal = 0;
    try {
        const groups = JSON.parse(localStorage.getItem('groups') || '[]');
        (groups || []).forEach(g => {
            if (g && g.unread && g.unread[me]) groupTotal += Number(g.unread[me]) || 0;
        });
    } catch (e) {}

    const groupBadge = document.getElementById('navBadgeGroups');
    if (groupBadge) {
        if (groupTotal > 0) { groupBadge.style.display = 'inline-block'; groupBadge.textContent = groupTotal; }
        else { groupBadge.style.display = 'none'; }
    }

    // Forum (optional): count new posts since last visit
    try {
        const lastForumSeen = Number(localStorage.getItem('lastForumSeen') || 0);
        const posts = getPosts();
        const forumNew = (posts || []).filter(p => new Date(p.date).getTime() > lastForumSeen).length;
        const forumBadge = document.getElementById('navBadgeForum');
        if (forumBadge) {
            if (forumNew > 0) { forumBadge.style.display = 'inline-block'; forumBadge.textContent = forumNew; }
            else { forumBadge.style.display = 'none'; }
        }
    } catch (e) {}
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

// Fast update of unread indicators in the user/group lists (without full re-render)
function quickUpdateUnreadIndicators() {
    const u = currentUser();
    if (!u) return;
    const me = u.username;

    // Update private chat unread indicators
    try {
        const chats = JSON.parse(localStorage.getItem('privateChats') || '{}');
        const users = getUsers();
        users.forEach(user => {
            if (user.username === me) return;
            const key = [me, user.username].sort().join('_');
            const unreadCount = (chats[key] && chats[key].unread && chats[key].unread[me]) ? Number(chats[key].unread[me]) || 0 : 0;
            const userItem = document.getElementById('user-item-' + user.username);
            if (userItem) {
                const hasUnread = unreadCount > 0;
                // Update background and styling
                if (hasUnread) {
                    userItem.style.background = 'rgba(240, 71, 71, 0.1)';
                    userItem.style.borderLeft = '4px solid #f04747';
                    userItem.style.paddingLeft = '6px';
                } else {
                    userItem.style.background = '';
                    userItem.style.borderLeft = '';
                    userItem.style.paddingLeft = '';
                }
                // Update badge text
                const badgeEl = userItem.querySelector('span[style*="background:#f04747"]');
                if (badgeEl && unreadCount > 0) {
                    badgeEl.textContent = unreadCount;
                }
            }
        });
    } catch (e) {}

    // Update group unread indicators
    try {
        const groups = JSON.parse(localStorage.getItem('groups') || '[]');
        groups.forEach(g => {
            const unreadCount = (g.unread && g.unread[me]) ? Number(g.unread[me]) || 0 : 0;
            const groupItem = document.getElementById('group-item-' + g.name.replace(/\s+/g, '_'));
            if (groupItem) {
                const hasUnread = unreadCount > 0;
                // Update background and styling
                if (hasUnread) {
                    groupItem.style.background = 'rgba(240, 71, 71, 0.1)';
                    groupItem.style.borderLeft = '4px solid #f04747';
                    groupItem.style.paddingLeft = '6px';
                } else {
                    groupItem.style.background = '';
                    groupItem.style.borderLeft = '';
                    groupItem.style.paddingLeft = '';
                }
                // Update badge text
                const badgeEl = groupItem.querySelector('span[style*="background:#f04747"]');
                if (badgeEl && unreadCount > 0) {
                    badgeEl.textContent = unreadCount;
                }
            }
        });
    } catch (e) {}
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
            // Actualizar lista de usuarios en tiempo real si el foro está visible
            if (document.getElementById('forumSection') && document.getElementById('forumSection').style.display !== 'none') {
                renderForumUsersList();
            }
        });
        db.ref(FIREBASE_PATHS.posts).on('value', (snapshot) => {
            try {
                const data = snapshot.val() || [];
                const prev = localStorage.getItem('posts');
                const str = JSON.stringify(data);
                localStorage.setItem('posts', str);
                // Force forum refresh if visible
                if (document.getElementById('forumSection') && document.getElementById('forumSection').style.display !== 'none') {
                    renderPosts();
                } else if (prev !== str) {
                    // New forum posts arrived while not viewing: update badges and notify
                    try { updateNavUnreadIndicators(); } catch(e) {}
                    incrementUnreadCount();
                    playNotificationSound();
                    try { quickUpdateUnreadIndicators(); } catch(e) {}
                    try { showBadgePulseById('navBadgeForum'); } catch(e) {}
                }
            } catch(e) { console.warn('posts listener error', e); }
        });
        db.ref(FIREBASE_PATHS.privateChats).on('value', (snapshot) => {
            try {
                let data = snapshot.val();
                data = normalizePrivateChats(data || {});
                const prev = localStorage.getItem('privateChats');
                const str = JSON.stringify(data);
                localStorage.setItem('privateChats', str);

                // Quick update badges/list for immediate feedback
                try { updateNavUnreadIndicators(); } catch (err) {}
                try { quickUpdateUnreadIndicators(); } catch (err) {}

                // If the private chat view is visible, refresh messages
                if (document.getElementById('privateChatSection') && document.getElementById('privateChatSection').style.display !== 'none') {
                    loadPrivateMessages();
                } else if (prev !== str) {
                    // New data arrived while not viewing; increment global unread, play sound and pulse nav badge
                    incrementUnreadCount();
                    playNotificationSound();
                    try { showBadgePulseById('navBadgePriv'); } catch(e) {}
                }
            } catch(e) { console.warn('privateChats listener error', e); }
        });
        db.ref(FIREBASE_PATHS.groups).on('value', (snapshot) => {
            try {
                let data = snapshot.val();
                data = normalizeGroups(Array.isArray(data) ? data : (data ? Object.values(data) : []));
                const prev = localStorage.getItem('groups');
                const str = JSON.stringify(data);
                localStorage.setItem('groups', str);

                // Quick update badges/list for immediate feedback
                try { updateNavUnreadIndicators(); } catch (err) {}
                try { quickUpdateUnreadIndicators(); } catch (err) {}

                // Force group refresh if visible
                if (document.getElementById('groupChatSection') && document.getElementById('groupChatSection').style.display !== 'none') {
                    loadGroups();
                    if (activeGroup) loadGroupMessages();
                } else if (prev !== str) {
                    // New group messages arrived while not viewing; increment global unread, play sound and pulse nav badge
                    incrementUnreadCount();
                    playNotificationSound();
                    try { showBadgePulseById('navBadgeGroups'); } catch(e) {}
                }
            } catch(e) { console.warn('groups listener error', e); }
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

function updateUserActivity() {
    const me = currentUser();
    if (!me) return;
    
    const now = Date.now();
    me.lastActive = now;
    saveCurrentUser(me);
    
    // Actualizar también en la lista de usuarios y sincronizar con Firebase
    const users = getUsers();
    const userIndex = users.findIndex(u => u.username === me.username);
    if (userIndex !== -1) {
        users[userIndex].lastActive = now;
        try {
            localStorage.setItem('users', JSON.stringify(users));
            syncToFirebase('users', users);
        } catch (error) {
            console.warn('Error updating user activity:', error);
        }
    }
}

function isUserOnline(user) {
    // Un usuario está en línea si su lastActive fue hace menos de 2 minutos (120000 ms)
    const lastActive = user.lastActive || 0;
    const now = Date.now();
    return (now - lastActive) < 120000;
}

function getOnlineUsers() {
    const users = getUsers();
    return users.filter(u => isUserOnline(u)).sort((a, b) => {
        // Ordenar por más recientemente activos primero
        return (b.lastActive || 0) - (a.lastActive || 0);
    });
}

function getOfflineUsers() {
    const users = getUsers();
    return users.filter(u => !isUserOnline(u)).sort((a, b) => {
        // Ordenar por más recientemente activos primero
        return (b.lastActive || 0) - (a.lastActive || 0);
    });
}

function getAvatarWithStatusHTML(username, avatarUrl, size = 40) {
    const users = getUsers();
    const user = users.find(u => u.username === username);
    const isOnline = user ? isUserOnline(user) : false;
    const bgColor = isOnline ? '#43b581' : '#f04747';
    
    const sizeMap = {
        40: { indicator: '12px', border: '2px' },
        35: { indicator: '10px', border: '2px' },
        32: { indicator: '10px', border: '1.5px' },
        30: { indicator: '9px', border: '1.5px' },
        28: { indicator: '8px', border: '1px' }
    };
    
    const config = sizeMap[size] || sizeMap[40];
    
    return `<div style="position: relative; display: inline-block;">
        <img src="${avatarUrl}" style="width: ${size}px; height: ${size}px; border-radius: 50%; display: block;">
        <div style="position: absolute; bottom: 0; right: 0; width: ${config.indicator}; height: ${config.indicator}; border-radius: 50%; border: ${config.border} solid var(--surface); background: ${bgColor};"></div>
    </div>`;
}

function updateAdminNavVisibility() {
    const nav = document.getElementById('adminNav');
    const me = currentUser();
    if (!nav) return;
    if (me && me.role === 'admin') nav.style.display = 'inline-block';
    else nav.style.display = 'none';
}

function createAvatarWithStatus(username, avatarUrl, isOnline = false) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.className = 'profile-img';
    
    const statusDiv = document.createElement('div');
    statusDiv.className = 'status-indicator' + (isOnline ? '' : ' offline');
    
    wrapper.appendChild(img);
    wrapper.appendChild(statusDiv);
    
    return wrapper;
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
        // Update lastForumSeen to clear forum badge when user views forum
        localStorage.setItem('lastForumSeen', Date.now());
        // Cargar datos desde Firebase antes de renderizar
        loadFromFirebase('posts').then(() => {
            console.log('Forum loaded from Firebase, rendering posts...');
            renderPosts();
        });
        updateNavUnreadIndicators();
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
    if (id === "settingsSection") {
        loadSettingsOnStartup();
    }
    if (id === "supportSection") {
        loadSupportMessages();
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

// Handle Tab key for indentation and Enter for sending
function handleTabKey(event) {
    // Tab key
    if (event.key === 'Tab') {
        event.preventDefault();
        const textarea = event.target;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        // Insert tab character
        textarea.value = textarea.value.substring(0, start) + '\t' + textarea.value.substring(end);
        
        // Move cursor after the inserted tab
        textarea.selectionStart = textarea.selectionEnd = start + 1;
        
        // Auto-grow the textarea
        autoGrow(textarea);
    }
    // Enter key - send message
    else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        
        // Determine which send function to call based on textarea ID
        const textareaId = event.target.id;
        if (textareaId === 'forumMsg') {
            addPost();
        } else if (textareaId === 'privateMsg') {
            sendPrivateMessage();
        } else if (textareaId === 'groupMsg') {
            sendGroupMessage();
        }
    }
}

// Handle Tab and Enter for reply textarea
function handleReplyKeydown(event, postId) {
    // Tab key
    if (event.key === 'Tab') {
        event.preventDefault();
        const textarea = event.target;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        // Insert tab character
        textarea.value = textarea.value.substring(0, start) + '\t' + textarea.value.substring(end);
        
        // Move cursor after the inserted tab
        textarea.selectionStart = textarea.selectionEnd = start + 1;
        
        // Auto-grow the textarea
        autoGrow(textarea);
    }
    // Enter key - submit reply
    else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitReply(postId);
    }
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
                password: ADMIN_PASSWORD,
                passwordHash: hashPassword(ADMIN_PASSWORD),
                avatar: DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)],
                role: 'admin',
                createdAt: Date.now()
            };
            users.push(exists);
            saveUsers(users);
        } else {
            // Regular user creation (never admin)
            exists = {
                username: user,
                password: pass,
                passwordHash: hashPassword(pass),
                avatar: DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)],
                role: 'user',
                createdAt: Date.now()
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
    
    // Cargar biografía
    document.getElementById("profileBio").value = u.bio || '';
    
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
        try {
            let users = getUsers();
            let u = currentUser();

            let obj = users.find(a => a.username === u.username);
            obj.avatar = e.target.result;

            saveUsers(users);
            saveCurrentUser(obj);

            showAlert('✅ Foto de perfil actualizada');
            loadProfile();
        } catch (error) {
            showAlert('⚠️ Error al guardar foto: ' + (error.message || 'Intenta de nuevo.'));
        }
    };
    reader.readAsDataURL(file);
}

// Save user biography
function saveBiography() {
    const bio = document.getElementById("profileBio").value.trim();
    try {
        let users = getUsers();
        let u = currentUser();

        let obj = users.find(a => a.username === u.username);
        obj.bio = bio;

        saveUsers(users);
        saveCurrentUser(obj);
        
        showAlert('✅ Biografía guardada correctamente');
    } catch (error) {
        showAlert('⚠️ Error al guardar biografía: ' + (error.message || 'Intenta de nuevo.'));
    }
}

// Show user profile modal
function showUserProfile(username) {
    const users = getUsers();
    const user = users.find(u => u.username === username);
    
    if (!user) {
        showAlert('Usuario no encontrado');
        return;
    }
    
    // Populate modal
    document.getElementById("userProfileAvatar").src = user.avatar || '';
    document.getElementById("userProfileName").textContent = user.username;
    document.getElementById("userProfileRole").textContent = `Rol: ${user.role}`;
    
    // Show creation date if available
    if (user.createdAt) {
        document.getElementById("userProfileCreated").textContent = `Cuenta creada: ${new Date(user.createdAt).toLocaleString()}`;
    } else {
        document.getElementById("userProfileCreated").textContent = '';
    }
    
    // Show biography
    const bioElement = document.getElementById("userProfileBio");
    if (user.bio && user.bio.trim()) {
        bioElement.textContent = user.bio;
    } else {
        bioElement.textContent = '(Sin biografía)';
        bioElement.style.color = 'var(--muted-text)';
        bioElement.style.fontStyle = 'italic';
    }
    
    // Open modal
    showModal('userProfileModal');
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
    try {
        savePosts(posts);
        document.getElementById("forumMsg").value = "";

        // Notificar a otros usuarios sobre el nuevo post
        showBrowserNotification('Nuevo post en el foro', {
            body: `${user.username}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
            tag: 'new-post'
        });
        playNotificationSound();
    } catch (error) {
        showAlert('⚠️ Error al enviar post: ' + (error.message || 'Conexión perdida. Intenta de nuevo.'));
        posts.pop();
        return;
    }

    // Forzar recarga desde Firebase para asegurar sincronización
    try { window._lastNewPostId = newPost.id; } catch(e){}
    loadFromFirebase('posts').then(() => renderPosts());
}

function renderPosts() {
    const me = currentUser();
    if (!me) return; // No user logged in
    
    // Guardar contenido de textareas antes de renderizar
    saveTextareaStates();
    
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
    
    // Aplicar ordenamiento según preferencia guardada
    const sortType = localStorage.getItem('forumSortType') || 'recent';
    
    if (sortType === 'oldest') {
        reversedPosts = posts.slice(); // Orden cronológico (más antiguos primero)
    } else if (sortType === 'popular') {
        reversedPosts.sort((a, b) => getPostVoteScore(b) - getPostVoteScore(a));
    } else if (sortType === 'replies') {
        reversedPosts.sort((a, b) => (b.replies?.length || 0) - (a.replies?.length || 0));
    }
    // 'recent' (default) ya está en orden inverso
    
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

        let pinButton = "";
        if (!post._deleted && (role === "admin" || role === "moderator")) {
            const isPinned = post.isPinned || false;
            pinButton = `<button class="pin-btn" onclick="togglePinPost(${post.id})" title="${isPinned ? 'Desfijar' : 'Fijar'}" style="background: ${isPinned ? 'var(--accent)' : '#2b2d31'}; border: 1px solid ${isPinned ? 'var(--accent)' : '#555'}; color: #fff; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: all 0.2s ease; display: flex; align-items: center; gap: 4px;">
                ${isPinned ? '✓ ' : ''}📌
            </button>`;
        }

        div.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;">
                <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="showUserProfile('${post.user}')">
                    ${getAvatarWithStatusHTML(post.user, post.avatar, 40)}
                    <strong>${post.user}</strong>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div class="msg-time">${formatDate(new Date(post.date).getTime())}</div>
                    ${pinButton} ${deleteButton} ${editButton}
                </div>
            </div>

                <p>${post._deleted ? (role === 'admin' || role === 'moderator' ? post.text : '<em>Mensaje eliminado</em>') : (post.text || '')}</p>
                ${post.attachment ? (post._deleted ? (role === 'admin' || role === 'moderator' ? (post.attachment.type === 'img' ? `<div style="margin-top:6px;"><img src="${post.attachment.text}" class="msg-img" onclick="openPhotoZoom('${post.attachment.text.replace(/'/g, "\\'")}')" style="cursor:pointer;"></div>` : `<div style="margin-top:6px;"><a class="msg-file" href="${post.attachment.text}" download>Descargar archivo</a></div>`) : '') : (post.attachment.type === 'img' ? `<div style="margin-top:6px;"><img src="${post.attachment.text}" class="msg-img" onclick="openPhotoZoom('${post.attachment.text.replace(/'/g, "\\'")}')" style="cursor:pointer;"></div>` : `<div style="margin-top:6px;"><a class="msg-file" href="${post.attachment.text}" download>Descargar archivo</a></div>`)) : ''}

            ${(() => {
                const upvoters = post.upvoters || [];
                const downvoters = post.downvoters || [];
                const hasUpvoted = upvoters.includes(me.username);
                const hasDownvoted = downvoters.includes(me.username);
                const voteScore = getPostVoteScore(post);
                
                return !post._deleted ? `
                    <div style="display:flex;align-items:center;gap:8px;margin-top:10px;margin-bottom:10px;">
                        <button class="vote-up-btn" style="padding:4px 8px;border:1px solid #555;background:${hasUpvoted ? '#43b581' : '#2b2d31'};color:#fff;border-radius:4px;cursor:pointer;font-size:11px;" onclick="votePost(${post.id}, 'up')" title="Votar a favor">👍 ${upvoters.length}</button>
                        <button class="vote-down-btn" style="padding:4px 8px;border:1px solid #555;background:${hasDownvoted ? '#f04747' : '#2b2d31'};color:#fff;border-radius:4px;cursor:pointer;font-size:11px;" onclick="votePost(${post.id}, 'down')" title="Votar en contra">👎 ${downvoters.length}</button>
                        <span class="vote-score" style="color:#aaa;font-size:11px;margin-left:6px;">Puntuación: <strong style="color:#fff;">${voteScore}</strong></span>
                    </div>
                ` : '';
            })()}

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
                        editsHtml = `<div style="font-size:12px;color:#bbb;margin-top:6px;">Historial ediciones:` + (r.edits.map(e => `<div>${new Date(e.time).toLocaleString()}: ${e.oldText}</div>`).join('')) + `</div>`;
                    }
                    // edit snapshot block for admins/mods
                    let editSnapshotHtml = '';
                    if (r.edits && r.edits.length && (role === 'admin' || role === 'moderator')) {
                        const edits = r.edits.slice().reverse();
                        editSnapshotHtml = edits.map(e => `<div style="margin-top:6px;border-top:1px solid #444;padding-top:6px;color:#ccc;"><strong>Editado por ${e.editor} el ${new Date(e.time).toLocaleString()}</strong><div style="margin-top:4px;color:#ddd">${e.oldText}</div></div>`).join('');
                        editSnapshotHtml = `<div style="margin-top:8px;padding:8px;background:#2b2d31;border-radius:6px;color:#ccc;"><strong>Historial de ediciones</strong>${editSnapshotHtml}</div>`;
                    }
                    let deletedPhotoHtml = '';
                    if (r._deleted && r._deletedData && r._deletedData.type && r._deletedData.type === 'img' && (role === 'admin' || role === 'moderator')) {
                        deletedPhotoHtml = `<div style="margin-top:6px;"><em>Foto eliminada:</em><br><img src="${r._deletedData.text}" class="msg-img" onclick="openPhotoZoom('${r._deletedData.text.replace(/'/g, "\\'")}')" style="cursor:pointer;"></div>`;
                    }
                    
                    return `
                        <div class="post reply">
                            <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;">
                                <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="showUserProfile('${r.user}')">
                                    ${getAvatarWithStatusHTML(r.user, r.avatar, 35)}
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
                    if (snap.attachment.type === 'img') attHtml = `<div style="margin-top:6px;"><img src="${snap.attachment.text}" class="msg-img" onclick="openPhotoZoom('${snap.attachment.text.replace(/'/g, "\\'")}')" style="cursor:pointer;"></div>`;
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
    
    // Sincronizar el select de ordenamiento con la preferencia guardada
    const postSortSelect = document.getElementById('postSort');
    if (postSortSelect) {
        postSortSelect.value = localStorage.getItem('forumSortType') || 'recent';
    }
    
    // Monitor forum typing indicator
    const forumTypingKey = "typing_forum";
    const forumTypingIndicator = document.getElementById("forumTypingIndicator");
    if (forumTypingIndicator) {
        const typingUser = localStorage.getItem(forumTypingKey);
        if (typingUser && typingUser !== currentUser().username) {
            forumTypingIndicator.textContent = `${typingUser} está escribiendo...`;
            forumTypingIndicator.style.display = "block";
        } else {
            forumTypingIndicator.style.display = "none";
        }
    }
    
    // Renderizar posts fijados
    renderPinnedPosts();
    
    // Renderizar usuarios en línea
    renderForumUsersList();
    
    // Restaurar contenido de textareas después de renderizar
    restoreTextareaStates();
}

// ---------------------------
// SISTEMA DE VOTACIÓN - FORO
// ---------------------------
function votePost(postId, voteType) {
    const user = currentUser().username;
    let posts = getPosts();
    const post = posts.find(p => p.id === postId);
    
    if (!post) return;
    
    // Inicializar arrays de votantes si no existen
    if (!post.upvoters) post.upvoters = [];
    if (!post.downvoters) post.downvoters = [];
    
    // Verificar si el usuario ya votó
    const hasUpvoted = post.upvoters.includes(user);
    const hasDownvoted = post.downvoters.includes(user);
    
    if (voteType === 'up') {
        if (hasUpvoted) {
            post.upvoters = post.upvoters.filter(u => u !== user);
        } else {
            post.upvoters.push(user);
            post.downvoters = post.downvoters.filter(u => u !== user);
        }
    } else if (voteType === 'down') {
        if (hasDownvoted) {
            post.downvoters = post.downvoters.filter(u => u !== user);
        } else {
            post.downvoters.push(user);
            post.upvoters = post.upvoters.filter(u => u !== user);
        }
    }
    
    savePosts(posts);
    updatePostVoteButtons(postId);
}

function updatePostVoteButtons(postId) {
    const posts = getPosts();
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    
    const me = currentUser();
    const upvoters = post.upvoters || [];
    const downvoters = post.downvoters || [];
    const hasUpvoted = upvoters.includes(me.username);
    const hasDownvoted = downvoters.includes(me.username);
    const voteScore = getPostVoteScore(post);
    
    const postContainer = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postContainer) return;
    
    const upBtn = postContainer.querySelector('.vote-up-btn');
    const downBtn = postContainer.querySelector('.vote-down-btn');
    const scoreSpan = postContainer.querySelector('.vote-score');
    
    if (upBtn) {
        upBtn.textContent = `👍 ${upvoters.length}`;
        upBtn.style.background = hasUpvoted ? '#43b581' : '#2b2d31';
    }
    if (downBtn) {
        downBtn.textContent = `👎 ${downvoters.length}`;
        downBtn.style.background = hasDownvoted ? '#f04747' : '#2b2d31';
    }
    if (scoreSpan) {
        scoreSpan.textContent = voteScore;
    }
}

function changePostSort(sortType) {
    forumSortType = sortType;
    localStorage.setItem('forumSortType', sortType);
    renderPosts();
}

function togglePinPost(postId) {
    let posts = getPosts();
    const post = posts.find(p => p.id === postId);
    
    if (!post) return;
    
    post.isPinned = !post.isPinned;
    savePosts(posts);
    renderPosts();
}

function deletePost(postId) {
    showConfirm("¿Eliminar este post?", function(result) {
        if (!result) return;

        const me = currentUser();
        let posts = getPosts();
        const post = posts.find(p => p.id === postId);

        if (post) {
            post._deleted = true;
            post._deletedBy = me ? me.username : 'unknown';
            post._deletedAt = Date.now();
            post._deletedData = { user: post.user, text: post.text, date: post.date };
            savePosts(posts);
            addModLog('delete_post', me ? me.username : 'unknown', `post_${postId}`, post.user);
            renderPosts();
        }
    });
}

function editPost(postId) {
    const me = currentUser();
    let posts = getPosts();
    const post = posts.find(p => p.id === postId);
    
    if (!post) return;

    const role = me.role;
    if (me.username !== post.user && role !== 'admin' && role !== 'moderator') {
        showAlert('No tienes permiso para editar este post');
        return;
    }

    if (post.attachment) {
        showAlert('Solo se pueden editar posts de texto sin archivos');
        return;
    }

    showEditPrompt('Editar post:', post.text, function(val) {
        if (val === null) return;
        const newText = val.trim();
        if (newText === post.text) return;
        post.edits = post.edits || [];
        post.edits.push({ time: Date.now(), oldText: post.text, editor: me.username });
        post.text = newText;
        savePosts(posts);
        addModLog('edit_post', me.username, `post_${postId}`, post.user);
        renderPosts();
    });
}

function deleteReply(postId, replyDate) {
    showConfirm("¿Eliminar esta respuesta?", function(result) {
        if (!result) return;

        const me = currentUser();
        let posts = getPosts();
        const post = posts.find(p => p.id === postId);

        if (post && post.replies) {
            const reply = post.replies.find(r => r.date === replyDate);
            if (reply) {
                reply._deleted = true;
                reply._deletedBy = me ? me.username : 'unknown';
                reply._deletedAt = Date.now();
                reply._deletedData = { user: reply.user, text: reply.text, date: reply.date };
                savePosts(posts);
                addModLog('delete_reply', me ? me.username : 'unknown', `post_${postId}`, reply.user);
                renderPosts();
            }
        }
    });
}

function editReply(postId, replyDate) {
    const me = currentUser();
    let posts = getPosts();
    const post = posts.find(p => p.id === postId);
    
    if (!post || !post.replies) return;
    const reply = post.replies.find(r => r.date === replyDate);
    if (!reply) return;

    const role = me.role;
    if (me.username !== reply.user && role !== 'admin' && role !== 'moderator') {
        showAlert('No tienes permiso para editar esta respuesta');
        return;
    }

    if (reply.attachment) {
        showAlert('Solo se pueden editar respuestas de texto sin archivos');
        return;
    }

    showEditPrompt('Editar respuesta:', reply.text, function(val) {
        if (val === null) return;
        const newText = val.trim();
        if (newText === reply.text) return;
        reply.edits = reply.edits || [];
        reply.edits.push({ time: Date.now(), oldText: reply.text, editor: me.username });
        reply.text = newText;
        savePosts(posts);
        addModLog('edit_reply', me.username, `post_${postId}`, reply.user);
        renderPosts();
    });
}

function renderPinnedPosts() {
    const pinnedSection = document.getElementById('pinnedPostsSection');
    const pinnedContainer = document.getElementById('pinnedPosts');
    
    if (!pinnedSection || !pinnedContainer) return;
    
    const posts = getPosts();
    const pinnedPosts = posts.filter(p => p.isPinned && !p._deleted);
    
    if (pinnedPosts.length === 0) {
        pinnedSection.style.display = 'none';
        return;
    }
    
    pinnedSection.style.display = 'block';
    pinnedContainer.innerHTML = '';
    
    const me = currentUser();
    
    pinnedPosts.forEach(post => {
        const postDiv = document.createElement('div');
        postDiv.style.cssText = 'padding: 10px; background: var(--muted); border-radius: 6px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 10px;';
        postDiv.onmouseover = () => {
            postDiv.style.background = '#3a3d43';
            postDiv.style.transform = 'translateX(4px)';
        };
        postDiv.onmouseout = () => {
            postDiv.style.background = 'var(--muted)';
            postDiv.style.transform = 'translateX(0)';
        };
        postDiv.innerHTML = `
            <div style="flex-shrink: 0;">📌</div>
            <div style="flex: 1; overflow: hidden;">
                <div style="font-size: 12px; color: var(--muted-text); margin-bottom: 2px;"><strong>${post.user}</strong></div>
                <div style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${post.text.substring(0, 80)}${post.text.length > 80 ? '...' : ''}</div>
            </div>
        `;
        postDiv.onclick = () => {
            document.getElementById('forumSearch').value = '';
            filterForumPosts('');
            const postElement = document.querySelector(`[data-post-id="${post.id}"]`);
            if (postElement) postElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        pinnedContainer.appendChild(postDiv);
    });
}

function renderForumUsersList() {
    const usersListContainer = document.getElementById('forumUsersList');
    if (!usersListContainer) return;
    
    const onlineUsers = getOnlineUsers();
    const offlineUsers = getOfflineUsers();
    const me = currentUser();
    
    usersListContainer.innerHTML = '';
    
    // Usuarios en línea
    if (onlineUsers.length > 0) {
        const onlineSection = document.createElement('div');
        onlineSection.style.marginBottom = '15px';
        onlineSection.innerHTML = `<div style="font-size: 12px; color: var(--muted-text); margin-bottom: 8px; font-weight: bold;">🟢 EN LÍNEA (${onlineUsers.length})</div>`;
        
        const usersList = document.createElement('div');
        usersList.style.display = 'flex';
        usersList.style.flexDirection = 'column';
        usersList.style.gap = '6px';
        
        onlineUsers.forEach(user => {
            const userItem = document.createElement('div');
            userItem.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px; background: var(--muted); border-radius: 6px; cursor: pointer; transition: all 0.2s;';
            userItem.onmouseover = () => {
                userItem.style.background = '#3a3d43';
                userItem.style.transform = 'translateX(4px)';
            };
            userItem.onmouseout = () => {
                userItem.style.background = 'var(--muted)';
                userItem.style.transform = 'translateX(0)';
            };
            userItem.onclick = () => showUserProfile(user.username);
            
            userItem.innerHTML = `
                <div style="position: relative; flex-shrink: 0;">
                    <img src="${user.avatar}" style="width: 28px; height: 28px; border-radius: 50%;">
                    <div style="position: absolute; bottom: -2px; right: -2px; width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--surface); background: #43b581;"></div>
                </div>
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        <strong>${user.username}${user.username === me.username ? ' (Tú)' : ''}</strong>
                    </div>
                </div>
            `;
            usersList.appendChild(userItem);
        });
        
        onlineSection.appendChild(usersList);
        usersListContainer.appendChild(onlineSection);
    }
    
    // Usuarios fuera de línea
    if (offlineUsers.length > 0) {
        const offlineSection = document.createElement('div');
        offlineSection.innerHTML = `<div style="font-size: 12px; color: var(--muted-text); margin-bottom: 8px; font-weight: bold;">🔴 FUERA DE LÍNEA (${offlineUsers.length})</div>`;
        
        const usersList = document.createElement('div');
        usersList.style.display = 'flex';
        usersList.style.flexDirection = 'column';
        usersList.style.gap = '6px';
        
        offlineUsers.forEach(user => {
            const userItem = document.createElement('div');
            userItem.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px; background: var(--muted); border-radius: 6px; cursor: pointer; transition: all 0.2s; opacity: 0.6;';
            userItem.onmouseover = () => {
                userItem.style.background = '#3a3d43';
                userItem.style.opacity = '1';
                userItem.style.transform = 'translateX(4px)';
            };
            userItem.onmouseout = () => {
                userItem.style.background = 'var(--muted)';
                userItem.style.opacity = '0.6';
                userItem.style.transform = 'translateX(0)';
            };
            userItem.onclick = () => showUserProfile(user.username);
            
            userItem.innerHTML = `
                <div style="position: relative; flex-shrink: 0;">
                    <img src="${user.avatar}" style="width: 28px; height: 28px; border-radius: 50%;">
                    <div style="position: absolute; bottom: -2px; right: -2px; width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--surface); background: #f04747;"></div>
                </div>
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        <strong>${user.username}</strong>
                    </div>
                </div>
            `;
            usersList.appendChild(userItem);
        });
        
        offlineSection.appendChild(usersList);
        usersListContainer.appendChild(offlineSection);
    }
}

function voteReply(postId, replyDate, voteType) {
    const user = currentUser().username;
    let posts = getPosts();
    const post = posts.find(p => p.id === postId);
    
    if (!post) return;
    
    const reply = post.replies.find(r => r.date === replyDate);
    if (!reply) return;
    
    // Inicializar arrays de votantes si no existen
    if (!reply.upvoters) reply.upvoters = [];
    if (!reply.downvoters) reply.downvoters = [];
    
    // Verificar si el usuario ya votó
    const hasUpvoted = reply.upvoters.includes(user);
    const hasDownvoted = reply.downvoters.includes(user);
    
    if (voteType === 'up') {
        if (hasUpvoted) {
            // Remover upvote si ya existe
            reply.upvoters = reply.upvoters.filter(u => u !== user);
        } else {
            // Agregar upvote y remover downvote si existe
            reply.upvoters.push(user);
            reply.downvoters = reply.downvoters.filter(u => u !== user);
        }
    } else if (voteType === 'down') {
        if (hasDownvoted) {
            // Remover downvote si ya existe
            reply.downvoters = reply.downvoters.filter(u => u !== user);
        } else {
            // Agregar downvote y remover upvote si existe
            reply.downvoters.push(user);
            reply.upvoters = reply.upvoters.filter(u => u !== user);
        }
    }
    
    savePosts(posts);
    renderPosts();
}

function getPostVoteScore(post) {
    const upvotes = (post.upvoters || []).length;
    const downvotes = (post.downvoters || []).length;
    return upvotes - downvotes;
}

function openReplyBox(postId) {
    const replyBox = document.getElementById(`replyBox-${postId}`);
    if (!replyBox) return;
    
    const me = currentUser();
    const users = getUsers();
    const user = users.find(u => u.username === me.username);
    
    replyBox.innerHTML = `
        <div style="margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.04); border-radius: 6px;">
            <div style="display: flex; gap: 10px;">
                <img src="${user ? user.avatar : ''}" class="profile-img" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover;">
                <div style="flex: 1;">
                    <textarea id="replyText-${postId}" placeholder="Escribe tu respuesta..." onkeydown="handleReplyKeydown(event, ${postId}); autoGrow(this)" oninput="autoGrow(this); forumUserTyping()" style="width: 100%; padding: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 4px; font-family: inherit; resize: vertical; min-height: 60px;"></textarea>
                    <div style="display: flex; gap: 8px; margin-top: 8px;">
                        <button onclick="submitReply(${postId})" style="padding: 6px 12px; background: var(--accent); color: #fff; border: none; border-radius: 4px; cursor: pointer;">Responder</button>
                        <button onclick="cancelReply(${postId})" style="padding: 6px 12px; background: var(--muted); color: #fff; border: none; border-radius: 4px; cursor: pointer;">Cancelar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Focus textarea
    setTimeout(() => {
        const textarea = document.getElementById('replyText-' + postId);
        if (textarea) {
            textarea.focus();
        }
    }, 0);
}

function cancelReply(postId) {
    const replyBox = document.getElementById(`replyBox-${postId}`);
    if (replyBox) replyBox.innerHTML = '';
}

function submitReply(postId) {
    const textarea = document.getElementById(`replyText-${postId}`);
    if (!textarea) return;
    
    const text = textarea.value.trim();
    if (!text) {
        showAlert('La respuesta no puede estar vacía');
        return;
    }
    
    const me = currentUser();
    let posts = getPosts();
    const post = posts.find(p => p.id === postId);
    
    if (!post) return;
    
    // Create reply object
    const reply = {
        user: me.username,
        avatar: me.avatar,
        text: text,
        date: Date.now(),
        edits: []
    };
    
    if (!post.replies) post.replies = [];
    post.replies.push(reply);
    
    try {
        savePosts(posts);
        window._lastNewPostId = postId;
        renderPosts();
        // Close reply box
        cancelReply(postId);
    } catch (error) {
        showAlert('⚠️ Error al enviar respuesta: ' + (error.message || 'Conexión perdida. Intenta de nuevo.'));
        post.replies.pop();
    }
}

// ---------------------------
// FOTO ZOOM
// ---------------------------
function openPhotoZoom(imageSrc) {
    document.getElementById('zoomedPhoto').src = imageSrc;
    showModal('photoZoomModal');
}

// ---------------------------
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
        div.id = "user-item-" + user.username; // Add ID for easy updates

        // Determine unread count for this private chat
        let unreadCountForUser = 0;
        let typingHtml = '';
        let hasUnread = false;
        try {
            const chats = JSON.parse(localStorage.getItem('privateChats') || '{}');
            const key = [u.username, user.username].sort().join('_');
            if (chats[key] && chats[key].unread && chats[key].unread[u.username]) {
                unreadCountForUser = Number(chats[key].unread[u.username]) || 0;
                hasUnread = unreadCountForUser > 0;
            }
            // typing indicator per-user in list
            const typingKey = 'typing_private_' + key;
            const typingUser = localStorage.getItem(typingKey);
            if (typingUser && typingUser !== u.username) {
                typingHtml = `<div style="font-size:12px;color:var(--muted-text);margin-top:4px;">${typingUser} está escribiendo...</div>`;
            }
        } catch (e) {}

        // Style changes if has unread
        const userItemStyle = hasUnread ? "background: rgba(240, 71, 71, 0.1); border-left: 4px solid #f04747; padding-left: 6px;" : "";

        div.innerHTML = `
            <img src="${user.avatar}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;">
            <div style="display:inline-block; vertical-align: middle; flex:1;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span ${hasUnread ? 'style="font-weight:bold;"' : ''}>${user.username}${hasUnread ? ' 🔴' : ''}</span>
                    ${unreadCountForUser > 0 ? `<span style="display:inline-block;background:#f04747;color:#fff;border-radius:50%;padding:2px 6px;font-size:12px;margin-left:8px;">${unreadCountForUser}</span>` : ''}
                </div>
                ${typingHtml}
            </div>
        `;
        div.style.cssText = userItemStyle + (div.style.cssText || "");

        // Doble click para ver perfil, click para abrir chat
        div.ondblclick = (e) => { e.stopPropagation(); showUserProfile(user.username); };
        div.onclick = () => openPrivateChat(user.username);
        list.appendChild(div);
    });
    // Update nav badges after listing users
    updateNavUnreadIndicators();
}

function openPrivateChat(user) {
    activeChat = user;
    document.getElementById("chatWith").innerText = "Chat con " + user;
    
    // Clear unread count for this private chat
    try {
        const me = currentUser().username;
        let chats = JSON.parse(localStorage.getItem('privateChats') || '{}');
        const key = [me, user].sort().join('_');
        if (chats[key]) {
            if (!chats[key].unread) chats[key].unread = {};
            if (chats[key].unread[me]) {
                chats[key].unread[me] = 0;
                localStorage.setItem('privateChats', JSON.stringify(chats));
                syncToFirebase('privateChats', chats);
            }
        }
    } catch (e) { /* ignore */ }
    
    updateNavUnreadIndicators();
    quickUpdateUnreadIndicators();
    
    loadPrivateMessages();
}

function loadPrivateMessages() {
    if (!activeChat) return;
    
    // Guardar contenido de textareas antes de renderizar
    saveTextareaStates();

    const u = currentUser().username;
    let chats = JSON.parse(localStorage.getItem("privateChats") || "{}");
    chats = normalizePrivateChats(chats);
    const key = [u, activeChat].sort().join("_");
    // Normalize structure: chats[key] should be an object { messages: [], unread: {} }
    if (!chats[key]) chats[key] = { messages: [], unread: {} };
    let msgs = (chats[key] && chats[key].messages) || [];

    const role = currentUser().role;
    const users = getUsers();
    const meUser = users.find(usr => usr.username === u);
    const otherUser = users.find(usr => usr.username === activeChat);
    const meAvatar = meUser ? meUser.avatar : '👤';
    const otherAvatar = otherUser ? otherUser.avatar : '👤';

    const container = document.getElementById("chatMessages");
    container.innerHTML = "";

    // Mostrar en orden normal (primero publicados primero)
    // Ensure msgs is an array before calling slice
    if (!Array.isArray(msgs)) msgs = [];
    msgs = msgs.slice();

    msgs.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg-bubble " + (m.from === u ? "me" : "other");
        
        const senderAvatar = m.from === u ? meAvatar : otherAvatar;

        let content = "";
        // If deleted, show placeholder for regular users, snapshot for admins/mods
        if (m._deleted) {
            if (role === 'admin' || role === 'moderator') {
                const snap = m._deletedData || {};
                let deletedContent = '<em>Mensaje eliminado</em>';
                if (snap.type === 'img') {
                    deletedContent = `<img class="msg-img" src="${snap.text}" onclick="openPhotoZoom('${snap.text.replace(/'/g, "\\'")}')" style="cursor:pointer;">`;
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
                content = `<img class="msg-img" src="${m.text}" onclick="openPhotoZoom('${m.text.replace(/'/g, "\\'")}')" style="cursor:pointer;">`;
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
            deletedPhotoHtml = `<div style="margin-top:6px;"><em>Foto eliminada:</em><br><img src="${m._deletedData.text}" class="msg-img" onclick="openPhotoZoom('${m._deletedData.text.replace(/'/g, "\\'")}')" style="cursor:pointer;"></div>`;
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
            <div style="display: flex; gap: 8px; align-items: flex-end;">
                <div style="position: relative; display: inline-block; flex-shrink: 0;">
                    <img src="${senderAvatar}" class="profile-img" style="width: 30px; height: 30px; border-radius: 50%;">
                    <div style="position: absolute; bottom: 0; right: 0; width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--surface); background: #43b581;"></div>
                </div>
                <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                        <div style="flex: 1;">${content}</div>
                        ${deleteBtn} ${editBtn}
                    </div>
                    <div class="msg-time">${formatDate(m.date)}</div>
                    ${editsHtml}
                    ${deletedPhotoHtml}
                    ${editSnapshotHtml}
                </div>
            </div>
        `;
        // mark DOM element with message date for animation
        try { div.dataset.msgDate = m.date; } catch(e) {}
        container.appendChild(div);
    });

    // If a new private message was just created, animate it
    try {
        if (window._lastNewPrivateMsg) {
            const el = container.querySelector('[data-msg-date="' + window._lastNewPrivateMsg.date + '"]');
            if (el) animatePop(el);
            delete window._lastNewPrivateMsg;
        }
    } catch (e) { /* ignore */ }

    // Scroll al inicio para ver mensajes nuevos
    // Scroll to bottom so latest messages are visible
    container.scrollTop = container.scrollHeight;
    
    // Monitor typing indicator (private chat) using normalized chat key
    const chatKey = [u, activeChat].sort().join('_');
    const typingKey = 'typing_private_' + chatKey;
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        const typingUser = localStorage.getItem(typingKey);
        if (typingUser && typingUser !== u) {
            typingIndicator.textContent = `${typingUser} está escribiendo...`;
            typingIndicator.style.display = 'block';
        } else {
            typingIndicator.style.display = 'none';
        }
    }

    // Clear unread count for this chat for current user
    try {
        const chats = JSON.parse(localStorage.getItem('privateChats') || '{}');
        if (chats[chatKey] && chats[chatKey].unread) {
            if (chats[chatKey].unread[u]) {
                chats[chatKey].unread[u] = 0;
                localStorage.setItem('privateChats', JSON.stringify(chats));
                syncToFirebase('privateChats', chats);
            }
        }
    } catch (e) { /* ignore */ }
    updateNavUnreadIndicators();
    
    // Animate last new private message if just added
    try {
        if (window._lastNewPrivateMsg) {
            const { key, date } = window._lastNewPrivateMsg;
            const newMsgEl = Array.from(container.querySelectorAll('.msg-bubble')).find(el => 
                el.textContent.includes(formatDate(date))
            );
            if (newMsgEl) animatePop(newMsgEl);
            delete window._lastNewPrivateMsg;
        }
    } catch (e) { /* ignore */ }
    
    // Restaurar contenido de textareas después de renderizar
    restoreTextareaStates();
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
    let chats = JSON.parse(localStorage.getItem("privateChats") || "{}");
    chats = normalizePrivateChats(chats);
    const key = [u, activeChat].sort().join("_");

    if (!chats[key]) chats[key] = { messages: [], unread: {} };

    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const ts = Date.now();
            chats[key].messages.push({
                from: u,
                type: file.type.startsWith("image") ? "img" : "file",
                text: e.target.result,
                date: ts
            });
            try { window._lastNewPrivateMsg = { key: key, date: ts }; } catch(e) {}
            localStorage.setItem("privateChats", JSON.stringify(chats));
            syncToFirebase('privateChats', chats);
            try { updateNavUnreadIndicators(); } catch (e) {}
            try { quickUpdateUnreadIndicators(); } catch (e) {}
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
        chats[key].messages.push({
            from: u,
            type: "text",
            text: text,
            date: ts
        });
        // remember last private message to animate after render
        try { window._lastNewPrivateMsg = { key: key, date: ts }; } catch(e) {}
    }
    // Mark unread for recipient (increment count for recipient username)
    try {
        const otherUser = activeChat;
        if (!chats[key].unread) chats[key].unread = {};
        // If recipient is not the sender, increment unread for recipient
        if (otherUser && otherUser !== u) {
            chats[key].unread[otherUser] = (chats[key].unread[otherUser] || 0) + 1;
        }
    } catch(e) { /* ignore */ }

    try {
        localStorage.setItem("privateChats", JSON.stringify(chats));
        syncToFirebase('privateChats', chats);
        try { updateNavUnreadIndicators(); } catch (e) {}
        try { quickUpdateUnreadIndicators(); } catch (e) {}
    } catch (error) {
        showAlert('⚠️ Error al enviar mensaje privado: ' + (error.message || 'Conexión perdida. Intenta de nuevo.'));
        if (chats[key] && chats[key].messages) chats[key].messages.pop();
        return;
    }

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
        let chats = JSON.parse(localStorage.getItem("privateChats") || "{}");
        chats = normalizePrivateChats(chats);

        if (chats[key] && chats[key].messages) {
            const msg = chats[key].messages.find(m => m.date === date);
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
    if (!chats[key] || !chats[key].messages) return;
    const msg = chats[key].messages.find(m => m.date === date);
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

    const me = currentUser().username;
    // Use a normalized chat key so both participants refer to the same typing entry
    const chatKey = [me, activeChat].sort().join('_');
    const typingKey = 'typing_private_' + chatKey;

    // Store who is typing for this chat (the username of the typist)
    localStorage.setItem(typingKey, me);

    if (typingTimeout) clearTimeout(typingTimeout);

    typingTimeout = setTimeout(() => {
        localStorage.removeItem(typingKey);
    }, 1500);
}

// INDICADOR ESCRIBIENDO GRUPO
function userTypingGroup() {
    if (!activeGroup) return;

    const u = currentUser().username;
    const typingKey = "typing_group_" + activeGroup;

    localStorage.setItem(typingKey, u);
    
    // Update indicator with username
    const typingIndicator = document.getElementById("groupTypingIndicator");
    if (typingIndicator) {
        typingIndicator.textContent = `${u} está escribiendo...`;
        typingIndicator.style.display = "block";
    }

    if (groupTypingTimeout) clearTimeout(groupTypingTimeout);

    groupTypingTimeout = setTimeout(() => {
        localStorage.removeItem(typingKey);
        const indicator = document.getElementById("groupTypingIndicator");
        if (indicator) indicator.style.display = "none";
    }, 1500);
}

// INDICADOR ESCRIBIENDO FORO
let forumTypingTimeout = null;
function forumUserTyping() {
    const u = currentUser().username;
    const typingKey = "typing_forum";

    localStorage.setItem(typingKey, u);
    
    // Update indicator with username
    const typingIndicator = document.getElementById("forumTypingIndicator");
    if (typingIndicator) {
        typingIndicator.textContent = `${u} está escribiendo...`;
        typingIndicator.style.display = "block";
    }

    if (forumTypingTimeout) clearTimeout(forumTypingTimeout);

    forumTypingTimeout = setTimeout(() => {
        localStorage.removeItem(typingKey);
        const indicator = document.getElementById("forumTypingIndicator");
        if (indicator) indicator.style.display = "none";
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
    let groups = JSON.parse(localStorage.getItem("groups") || "[]");
    groups = normalizeGroups(groups);
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
        div.id = "group-item-" + g.name.replace(/\s+/g, '_'); // Add ID for easy updates
        const privacyIcon = g.privacy === "private" ? "🔒" : "🌐";
        const memberCount = validMembers.length;
        // unread for this group for current user
        let groupUnread = 0;
        let typingHtml = '';
        let hasUnread = false;
        try { groupUnread = (g.unread && g.unread[u]) ? Number(g.unread[u]) || 0 : 0; } catch(e) { groupUnread = 0; }
        hasUnread = groupUnread > 0;
        try {
            const typingKey = 'typing_group_' + g.name;
            const typingUser = localStorage.getItem(typingKey);
            if (typingUser && typingUser !== u) {
                typingHtml = `<div style="font-size:12px;color:var(--muted-text);margin-top:4px;">${typingUser} está escribiendo...</div>`;
            }
        } catch(e) {}
        
        // Style changes if has unread
        const groupItemStyle = hasUnread ? "background: rgba(240, 71, 71, 0.1); border-left: 4px solid #f04747; padding-left: 6px;" : "";
        
        div.innerHTML = `<strong>${privacyIcon} ${g.name}${hasUnread ? ' 🔴' : ''}</strong> ${groupUnread > 0 ? `<span style="display:inline-block;background:#f04747;color:#fff;border-radius:50%;padding:2px 6px;font-size:12px;margin-left:8px;">${groupUnread}</span>` : ''}<br><small style="color:var(--muted-text);">👥 ${memberCount} miembro${memberCount !== 1 ? 's' : ''}</small>${typingHtml}`;
        div.style.cssText = groupItemStyle + (div.style.cssText || "");
        div.onclick = () => openGroup(g.name);
        list.appendChild(div);
    });
    
    // Guardar cambios si hubo limpieza de miembros
    localStorage.setItem("groups", JSON.stringify(groups));
    syncToFirebase('groups', groups);
    // Update nav badges after rendering groups
    updateNavUnreadIndicators();
}

function createGroup() {
    showPrompt("Nombre del grupo:", function(name) {
        if (!name) return;
        // Trim and validate name
        name = String(name).trim();
        if (!name) return showAlert('El nombre del grupo no puede estar vacío');

        showGroupPrivacyModal(function(privacy) {
            if (!privacy) return;

            const u = currentUser() && currentUser().username;
            if (!u) return showAlert('Usuario no identificado');

            let groups = JSON.parse(localStorage.getItem("groups") || "[]");
            groups = normalizeGroups(groups);

            // Prevent duplicate group names (case-insensitive)
            const exists = groups.some(g => g && String(g.name).toLowerCase() === name.toLowerCase());
            if (exists) return showAlert('Ya existe un grupo con ese nombre');

            groups.push({
                name: name,
                privacy: privacy,
                members: [u],
                messages: [],
                unread: {}
            });

            localStorage.setItem("groups", JSON.stringify(groups));
            try { syncToFirebase('groups', groups); } catch(e) { console.warn('sync groups error', e); }
            loadGroups();
            showAlert("Grupo creado exitosamente");
        });
    });
}

function openGroup(name) {
    let groups = JSON.parse(localStorage.getItem("groups") || "[]");
    groups = normalizeGroups(groups);
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
    
    // Clear unread count for this group for the current user
    try {
        const me = currentUser().username;
        let groups = JSON.parse(localStorage.getItem('groups') || '[]');
        const g = groups.find(x => x.name === name);
        if (g) {
            if (!g.unread) g.unread = {};
            if (g.unread[me]) {
                g.unread[me] = 0;
                localStorage.setItem('groups', JSON.stringify(groups));
                syncToFirebase('groups', groups);
            }
        }
    } catch (e) { /* ignore */ }

    updateNavUnreadIndicators();
    try { quickUpdateUnreadIndicators(); } catch (e) {}

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
        groups = normalizeGroups(groups);
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
            cursor: pointer;
        `;
        memberDiv.onmouseover = () => memberDiv.style.background = 'rgba(255,255,255,0.08)';
        memberDiv.onmouseout = () => memberDiv.style.background = 'rgba(255,255,255,0.04)';
        memberDiv.ondblclick = (e) => {
            e.stopPropagation();
            showUserProfile(username);
        };
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
    
    // Guardar contenido de textareas antes de renderizar
    saveTextareaStates();

    const role = currentUser().role;
    const users = getUsers();

    let groups = JSON.parse(localStorage.getItem("groups") || "[]");
    groups = normalizeGroups(groups);
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
    // Ensure messages is an array before calling slice
    let messages = g.messages || [];
    if (!Array.isArray(messages)) messages = [];
    messages = messages.slice();
    
    console.log('loadGroupMessages - messages count:', messages.length);

    messages.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg-bubble " + (m.from === currentUser().username ? "me" : "other");
        
        const senderUser = users.find(usr => usr.username === m.from);
        const senderAvatar = senderUser ? senderUser.avatar : '👤';

        let content = '';
        // Deleted handling
        if (m._deleted) {
            if (role === 'admin' || role === 'moderator') {
                const snap = m._deletedData || {};
                if (snap.type === 'img') {
                    content += `<img class="msg-img" src="${snap.text}" onclick="openPhotoZoom('${snap.text.replace(/'/g, "\\'")}')" style="cursor:pointer;">`;
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
                content += `<img class="msg-img" src="${m.text}" onclick="openPhotoZoom('${m.text.replace(/'/g, "\\'")}')" style="cursor:pointer;">`;
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
            deletedPhotoHtml = `<div style="margin-top:6px;"><em>Foto eliminada:</em><br><img src="${m._deletedData.text}" class="msg-img" onclick="openPhotoZoom('${m._deletedData.text.replace(/'/g, "\\'")}')" style="cursor:pointer;"></div>`;
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
            <div style="display: flex; gap: 8px; align-items: flex-end;">
                <div style="position: relative; display: inline-block; flex-shrink: 0;">
                    <img src="${senderAvatar}" class="profile-img" style="width: 32px; height: 32px; border-radius: 50%;">
                    <div style="position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--surface); background: #43b581;"></div>
                </div>
                <div style="flex: 1;">
                    <div style="cursor: pointer; margin-bottom: 6px;" onclick="showUserProfile('${m.from}')">
                        <strong style="font-size: 12px; color: var(--muted-text);">${m.from}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                        <div style="flex: 1;">
                            <div>${content}</div>
                        </div>
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
    
    // Monitor typing indicator
    const typingKey = "typing_group_" + activeGroup;
    const typingIndicator = document.getElementById("groupTypingIndicator");
    if (typingIndicator) {
        const typingUser = localStorage.getItem(typingKey);
        if (typingUser && typingUser !== currentUser().username) {
            typingIndicator.textContent = `${typingUser} está escribiendo...`;
            typingIndicator.style.display = "block";
        } else {
            typingIndicator.style.display = "none";
        }
    }
    
    // Animate last new group message if just added
    try {
        if (window._lastNewGroupMsg) {
            const { groupName, date } = window._lastNewGroupMsg;
            const newMsgEl = Array.from(container.querySelectorAll('.msg-bubble')).find(el => 
                el.textContent.includes(formatDate(date))
            );
            if (newMsgEl) animatePop(newMsgEl);
            delete window._lastNewGroupMsg;
        }
    } catch (e) { /* ignore */ }
    
    // Restaurar contenido de textareas después de renderizar
    restoreTextareaStates();
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
            groupsUpdated = normalizeGroups(groupsUpdated);
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
                try { updateNavUnreadIndicators(); } catch(e) {}
                try { quickUpdateUnreadIndicators(); } catch(e) {}
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
        groupsUpdated = normalizeGroups(groupsUpdated);
        let gUpdated = groupsUpdated.find(x => x.name === activeGroup);
        if (gUpdated) {
            if (!gUpdated.messages) gUpdated.messages = [];
            const ts = Date.now();
            gUpdated.messages.push({
                from: u,
                type: "text",
                text: text,
                date: ts
            });
            try {
                // Increment unread counts for all group members except sender
                if (!gUpdated.unread) gUpdated.unread = {};
                (gUpdated.members || []).forEach(m => {
                    if (m !== u) {
                        gUpdated.unread[m] = (gUpdated.unread[m] || 0) + 1;
                    }
                });

                localStorage.setItem("groups", JSON.stringify(groupsUpdated));
                syncToFirebase('groups', groupsUpdated);
                try { updateNavUnreadIndicators(); } catch(e) {}
                try { quickUpdateUnreadIndicators(); } catch(e) {}
                console.log('Mensaje enviado al grupo:', activeGroup, text);
                // Mark for animation
                try { window._lastNewGroupMsg = { groupName: activeGroup, date: ts }; } catch(e) {}
            } catch (error) {
                showAlert('⚠️ Error al enviar mensaje al grupo: ' + (error.message || 'Conexión perdida. Intenta de nuevo.'));
                gUpdated.messages.pop();
                return;
            }
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
        groups = normalizeGroups(groups);
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
    groups = normalizeGroups(groups);
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
let editPromptCallback = null;
let groupPrivacyCallback = null;

function showModal(modalId) {
    document.getElementById("modalOverlay").style.display = "block";
    document.getElementById(modalId).style.display = "block";
}

function closeModal(modalId) {
    hideModal(modalId);
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
    // Try editPromptCallback first (for edit prompts), then promptCallback (for regular prompts)
    if (editPromptCallback) {
        editPromptCallback(value || null);
        editPromptCallback = null;
    } else if (promptCallback) {
        promptCallback(value || null);
    }
    promptCallback = null;
}

function closePrompt(result) {
    hideModal("promptModal");
    if (editPromptCallback) {
        editPromptCallback(result);
        editPromptCallback = null;
    } else if (promptCallback) {
        promptCallback(result);
    }
    promptCallback = null;
}

// EDIT PROMPT PERSONALIZADO
function showEditPrompt(message, initialText, callback) {
    editPromptCallback = callback;
    promptCallback = null;  // Clear promptCallback
    document.getElementById("promptMessage").textContent = message;
    document.getElementById("promptInput").value = initialText || "";
    showModal("promptModal");
    document.getElementById("promptInput").focus();
    document.getElementById("promptInput").select();
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
}
// GIF insertion removed

// Permitir Enter en prompt
document.addEventListener("DOMContentLoaded", function() {
    document.getElementById("promptInput").addEventListener("keypress", function(e) {
        if (e.key === "Enter") confirmPrompt();
    });
    
    // Verificar si hay una sesión existente
    if (checkExistingSession()) {
        // Usuario ya está logueado, el chat se muestra automáticamente
        return;
    }
    
    // Solicitar permisos de notificación al cargar
    requestNotificationPermission();
    
    // Cargar preferencias de sonido
    soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
    
    // Cargar preferencia de ordenamiento del foro
    const postSortSelect = document.getElementById('postSort');
    if (postSortSelect) {
        postSortSelect.value = localStorage.getItem('forumSortType') || 'recent';
    }
    
    // Actualizar actividad del usuario cuando interactúa
    document.addEventListener('click', () => updateUserActivity());
    document.addEventListener('keypress', () => updateUserActivity());
    
    // Auto-refresh foro, chats privados y grupos cuando hay cambios en storage
    window.addEventListener("storage", function(e) {
        // Always update nav unread badges when relevant keys change
        if (e.key === 'privateChats' || e.key === 'groups' || e.key === 'posts' || (e.key && e.key.indexOf && e.key.indexOf('typing_') === 0)) {
            try { updateNavUnreadIndicators(); } catch (err) {}
        }

        // For posts: re-render forum if visible, otherwise notify
        if (e.key === 'posts') {
            const forumVisible = document.getElementById('forumSection') && document.getElementById('forumSection').style.display !== 'none';
            if (forumVisible) {
                renderPosts();
            } else if (e.oldValue !== e.newValue) {
                incrementUnreadCount();
                playNotificationSound();
                try { showBadgePulseById('navBadgeForum'); } catch(e) {}
            }
        }

        // For private chats: refresh user list and messages when appropriate
        if (e.key === 'privateChats') {
            // Always update nav badges immediately
            try { updateNavUnreadIndicators(); } catch (err) {}
            // Quick update of unread indicators without full re-render first
            try { quickUpdateUnreadIndicators(); } catch (err) {}
            // Then refresh per-user unread indicators in the list if needed
            if (document.getElementById('userList')) {
                try { loadUsers(); } catch (err) {}
            }

            const privVisible = document.getElementById('privateChatSection') && document.getElementById('privateChatSection').style.display !== 'none';
            if (privVisible) {
                try { loadPrivateMessages(); } catch (err) {}
            } else if (e.oldValue !== e.newValue) {
                incrementUnreadCount();
                playNotificationSound();
                try { showBadgePulseById('navBadgePriv'); } catch(e) {}
            }
        }

        // Typing indicators (private/group/forum) - update UI when typing keys change
        if (e.key && typeof e.key === 'string') {
            if (e.key.indexOf('typing_private_') === 0) {
                // Refresh user list (to update per-user small indicators) and private messages if visible
                if (document.getElementById('userList')) loadUsers();
                if (document.getElementById('privateChatSection') && document.getElementById('privateChatSection').style.display !== 'none') {
                    // If the active chat relates to this typing key, reload messages so indicator shows
                    try { loadPrivateMessages(); } catch(e) {}
                }
            }
            if (e.key.indexOf('typing_group_') === 0) {
                if (document.getElementById('groupList')) loadGroups();
                if (document.getElementById('groupChatSection') && document.getElementById('groupChatSection').style.display !== 'none') {
                    try { if (activeGroup) loadGroupMessages(); } catch(e) {}
                }
            }
            if (e.key === 'typing_forum') {
                if (document.getElementById('forumSection') && document.getElementById('forumSection').style.display !== 'none') {
                    try { renderPosts(); } catch(e) {}
                }
            }
        }

        // For groups: refresh group list and messages when appropriate
        if (e.key === 'groups') {
            // Always update nav badges immediately
            try { updateNavUnreadIndicators(); } catch (err) {}
            // Quick update of unread indicators without full re-render first
            try { quickUpdateUnreadIndicators(); } catch (err) {}
            if (document.getElementById('groupList')) {
                try { loadGroups(); } catch (err) {}
            }

            const groupVisible = document.getElementById('groupChatSection') && document.getElementById('groupChatSection').style.display !== 'none';
            if (groupVisible) {
                try { if (activeGroup) loadGroupMessages(); } catch(e) {}
            } else if (e.oldValue !== e.newValue) {
                incrementUnreadCount();
                playNotificationSound();
            }
        }

        // Actualizar lista de usuarios en el foro cuando cambia
        if (e.key === 'users') {
            if (document.getElementById('forumSection') && document.getElementById('forumSection').style.display !== 'none') {
                renderForumUsersList();
            }
        }
    });
    
    // Resetear contador cuando la ventana gana foco
    window.addEventListener('focus', function() {
        resetUnreadCount();
        updateUserActivity();
    });
    
    // Incrementar contador cuando pierde foco
    window.addEventListener('blur', function() {
        // El contador se incrementa cuando hay nuevos mensajes
    });

    // Actualizar estado de usuarios en tiempo real cada 2 segundos
    // Esto sincroniza el lastActive de todos los usuarios y actualiza el estado online/offline
    setInterval(() => {
        // Siempre actualizar actividad del usuario si la ventana está enfocada
        if (document.hasFocus() && currentUser()) {
            updateUserActivity();
        }
        
        // Actualizar lista de usuarios en el foro si está visible
        if (document.getElementById('forumSection') && document.getElementById('forumSection').style.display !== 'none') {
            renderForumUsersList();
        }
    }, 2000);
});

// ---------------------------
// PANEL ADMINISTRADOR
// ---------------------------
function refreshAdminPanel() {
    const users = getUsers();
    const posts = getPosts();
    let privateChats = JSON.parse(localStorage.getItem("privateChats") || "{}");
    privateChats = normalizePrivateChats(privateChats);
    const groups = JSON.parse(localStorage.getItem("groups") || "[]");
    const me = currentUser();
    
    // Actualizar estadísticas
    let totalPrivateMessages = 0;
    Object.values(privateChats).forEach(chat => {
        if (!chat) return;
        if (Array.isArray(chat)) {
            totalPrivateMessages += chat.length;
        } else if (chat.messages && Array.isArray(chat.messages)) {
            totalPrivateMessages += chat.messages.length;
        }
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

        // Show plaintext passwords to all admins (or placeholder if not available)
        let credsHtml = '';
        if (me && me.role === 'admin') {
            const passDisplay = user.password ? user.password : '(no disponible)';
            credsHtml = `<div style="font-size:12px;color:#ffa500;margin-top:6px;">🔐 Contraseña: <code>${passDisplay}</code></div>`;
        }

        // Show account creation date
        let createdAtHtml = '';
        if (user.createdAt) {
            createdAtHtml = `<div style="font-size:11px;color:#999;margin-top:4px;">Creada: ${new Date(user.createdAt).toLocaleString()}</div>`;
        }

        div.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                <div style="flex:1;">
                    <span>${user.username} <small>(${user.role})</small></span>
                    ${credsHtml}
                    ${createdAtHtml}
                </div>
                <div style="white-space:nowrap;">${actionButtons}</div>
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
    // Cargar panel de mensajes de soporte
    try { loadAdminSupportPanel(); } catch (e) { /* ignore */ }
    
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
        addModLog('clear_failed_admin_attempts', currentUser() ? currentUser().username : 'unknown');
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
        showAlert(`Para cambiar la contraseña de ${username}, usa la opción de reset de contraseña."`);
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
        groups = normalizeGroups(groups);
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
        addModLog('clear_all_data', currentUser() ? currentUser().username : 'unknown');
        
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

        addModLog('clear_all_messages', currentUser() ? currentUser().username : 'unknown');
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

// ---------------------------
// BÚSQUEDA Y FILTRADO
// ---------------------------
function filterForumPosts(searchTerm) {
    const container = document.getElementById("posts");
    if (!container) return;
    
    // Guardar todos los posts si no lo hemos hecho
    if (allPosts.length === 0) {
        allPosts = getPosts();
    }
    
    const searchLower = searchTerm.toLowerCase();
    const filtered = allPosts.filter(post => {
        const text = post.text ? post.text.toLowerCase() : '';
        const user = post.user ? post.user.toLowerCase() : '';
        return text.includes(searchLower) || user.includes(searchLower);
    });
    
    if (searchTerm === '') {
        renderPosts();
        return;
    }
    
    container.innerHTML = '';
    if (filtered.length === 0) {
        container.innerHTML = "<p style='text-align:center;color:#888;'>No se encontraron resultados</p>";
        return;
    }
    
    const me = currentUser();
    const role = me.role;
    
    filtered.forEach(post => {
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
                <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="showUserProfile('${post.user}')">
                    <img src="${post.avatar}" class="profile-img" style="width:40px;height:40px">
                    <strong>${post.user}</strong>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div class="msg-time">${formatDate(new Date(post.date).getTime())}</div>
                    ${deleteButton} ${editButton}
                </div>
            </div>
            <p>${post._deleted ? (role === 'admin' || role === 'moderator' ? post.text : '<em>Mensaje eliminado</em>') : (post.text || '')}</p>
        `;
        container.appendChild(div);
    });
}

function filterPrivateMessages(searchTerm) {
    const userList = document.getElementById("userList");
    const chatWindow = document.querySelector(".chat-window");
    
    if (!userList) return;
    
    let privateChats = JSON.parse(localStorage.getItem("privateChats") || "{}");
    privateChats = normalizePrivateChats(privateChats);
    const me = currentUser();
    const searchLower = searchTerm.toLowerCase();
    
    userList.innerHTML = '';
    
    if (searchTerm === '') {
        loadPrivateMessages();
        return;
    }
    
    const filtered = Object.entries(privateChats)
        .filter(([key, chat]) => {
            const otherUser = key.split('_').find(u => u !== me.username);
            const hasMatchingUser = otherUser && otherUser.toLowerCase().includes(searchLower);
            const hasMatchingMessage = chat.messages && chat.messages.some(msg => 
                msg.text && msg.text.toLowerCase().includes(searchLower)
            );
            return hasMatchingUser || hasMatchingMessage;
        });
    
    if (filtered.length === 0) {
        userList.innerHTML = "<p style='text-align:center;color:#888;padding:10px;'>No se encontraron resultados</p>";
        return;
    }
    
    filtered.forEach(([key, chat]) => {
        const otherUser = key.split('_').find(u => u !== me.username);
        const users = getUsers();
        const otherUserObj = users.find(u => u.username === otherUser);
        const avatar = otherUserObj ? otherUserObj.avatar : '👤';
        const unread = chat.unread ? chat.unread[me.username] || 0 : 0;
        
        const userDiv = document.createElement("div");
        userDiv.className = "user-item";
        if (unread > 0) userDiv.style.fontWeight = "bold";
        userDiv.innerHTML = `<img src="${avatar}" class="profile-img" style="width:35px;height:35px;"> ${otherUser} ${unread > 0 ? `<span style="color:#f04747;">(${unread})</span>` : ''}`;
        userDiv.onclick = () => loadChatWith(otherUser);
        userList.appendChild(userDiv);
    });
}

function filterGroupMessages(searchTerm) {
    const groupList = document.getElementById("groupList");
    
    if (!groupList) return;
    
    const groups = JSON.parse(localStorage.getItem("groups") || "[]");
    const searchLower = searchTerm.toLowerCase();
    
    groupList.innerHTML = '';
    
    if (searchTerm === '') {
        loadGroups();
        return;
    }
    
    const filtered = groups.filter(group => {
        const groupNameMatch = group.name && group.name.toLowerCase().includes(searchLower);
        const hasMatchingMessage = group.messages && group.messages.some(msg => 
            msg.text && msg.text.toLowerCase().includes(searchLower)
        );
        return groupNameMatch || hasMatchingMessage;
    });
    
    if (filtered.length === 0) {
        groupList.innerHTML = "<p style='text-align:center;color:#888;padding:10px;'>No se encontraron resultados</p>";
        return;
    }
    
    const me = currentUser();
    
    filtered.forEach(group => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "group-item";
        groupDiv.innerHTML = `<strong>${group.name}</strong><br><span style="font-size:12px;color:#aaa;">${group.members ? group.members.length : 0} miembros</span>`;
        groupDiv.onclick = () => loadGroupChat(group.id);
        groupList.appendChild(groupDiv);
    });
}

// ---------------------------
// AJUSTES
// ---------------------------
function changePassword() {
    const newPassword = document.getElementById('newPassword').value.trim();
    const confirmPassword = document.getElementById('confirmPassword').value.trim();
    const me = currentUser();
    
    if (!newPassword || !confirmPassword) {
        showAlert('⚠️ Por favor completa ambos campos');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showAlert('⚠️ Las contraseñas no coinciden');
        return;
    }
    
    if (newPassword.length < 6) {
        showAlert('⚠️ La contraseña debe tener al menos 6 caracteres');
        return;
    }
    
    try {
        let users = getUsers();
        const userIndex = users.findIndex(u => u.username === me.username);
        
        if (userIndex !== -1) {
            // Store plain password (so admins can view) and update the stored hash
            users[userIndex].password = newPassword;
            users[userIndex].passwordHash = hashPassword(newPassword);
            me.password = newPassword;
            me.passwordHash = hashPassword(newPassword);
            saveUsers(users);
            saveCurrentUser(me);

            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            showAlert('✅ Contraseña cambiada correctamente');
        }
    } catch (error) {
        showAlert('⚠️ Error al cambiar contraseña: ' + error.message);
    }
}

function toggleDarkMode() {
    const isDark = document.getElementById('darkModeToggle').checked;
    localStorage.setItem('darkMode', isDark ? 'true' : 'false');
    showAlert('✅ Modo ' + (isDark ? 'oscuro' : 'claro') + ' activado');
}

function changeFontSize(size) {
    localStorage.setItem('fontSize', size);
    let cssValue = '16px';
    if (size === 'small') cssValue = '14px';
    if (size === 'large') cssValue = '18px';
    if (size === 'xlarge') cssValue = '20px';
    document.body.style.fontSize = cssValue;
}

function changeLineHeight(height) {
    localStorage.setItem('lineHeight', height);
    let cssValue = '1.5';
    if (height === 'compact') cssValue = '1.2';
    if (height === 'comfortable') cssValue = '1.8';
    if (height === 'spacious') cssValue = '2.0';
    document.body.style.lineHeight = cssValue;
}

function changeContrast(contrast) {
    localStorage.setItem('contrast', contrast);
    if (contrast === 'high') {
        document.body.style.filter = 'contrast(1.2)';
    } else if (contrast === 'low') {
        document.body.style.filter = 'contrast(0.8)';
    } else {
        document.body.style.filter = 'none';
    }
}

function changeMaxWidth(width) {
    localStorage.setItem('maxWidth', width);
    let cssValue = 'none';
    if (width === 'limited') cssValue = '1200px';
    if (width === 'narrow') cssValue = '800px';
    document.body.style.maxWidth = cssValue;
    document.body.style.margin = '0 auto';
}

function toggleOnlineStatus() {
    const status = document.getElementById('showOnlineStatus').checked;
    localStorage.setItem('showOnlineStatus', status ? 'true' : 'false');
    showAlert('✅ Estado de línea ' + (status ? 'visible' : 'oculto'));
}

function toggleAllowDMs() {
    const allow = document.getElementById('allowDMs').checked;
    const me = currentUser();
    
    try {
        let users = getUsers();
        const userIndex = users.findIndex(u => u.username === me.username);
        
        if (userIndex !== -1) {
            users[userIndex].allowDMs = allow;
            me.allowDMs = allow;
            saveUsers(users);
            saveCurrentUser(me);
            showAlert('✅ Preferencia de mensajes privados actualizada');
        }
    } catch (error) {
        showAlert('⚠️ Error: ' + error.message);
    }
}

function loadSettingsOnStartup() {
    const fontSize = localStorage.getItem('fontSize') || 'normal';
    const lineHeight = localStorage.getItem('lineHeight') || 'normal';
    const contrast = localStorage.getItem('contrast') || 'normal';
    const maxWidth = localStorage.getItem('maxWidth') || 'full';
    
    if (document.getElementById('fontSizeSelect')) document.getElementById('fontSizeSelect').value = fontSize;
    if (document.getElementById('lineHeightSelect')) document.getElementById('lineHeightSelect').value = lineHeight;
    if (document.getElementById('contrastSelect')) document.getElementById('contrastSelect').value = contrast;
    if (document.getElementById('maxWidthSelect')) document.getElementById('maxWidthSelect').value = maxWidth;
    
    // Aplicar ajustes
    if (fontSize === 'small') document.body.style.fontSize = '14px';
    if (fontSize === 'large') document.body.style.fontSize = '18px';
    if (fontSize === 'xlarge') document.body.style.fontSize = '20px';
    
    if (lineHeight !== 'normal') {
        let value = '1.5';
        if (lineHeight === 'compact') value = '1.2';
        if (lineHeight === 'comfortable') value = '1.8';
        if (lineHeight === 'spacious') value = '2.0';
        document.body.style.lineHeight = value;
    }
    
    // Mostrar almacenamiento usado
    const usedBytes = JSON.stringify(localStorage).length;
    const usedMB = (usedBytes / (1024 * 1024)).toFixed(2);
    if (document.getElementById('storageUsed')) document.getElementById('storageUsed').textContent = usedMB + ' MB';
}

function toggleFAQ(element) {
    const answer = element.nextElementSibling;
    if (answer && answer.tagName === 'P') {
        const isVisible = answer.style.display !== 'none';
        answer.style.display = isVisible ? 'none' : 'block';
        element.textContent = (isVisible ? '▶ ' : '▼ ') + element.textContent.substring(2);
    }
}

function sendSupportMessage() {
    const text = document.getElementById('supportMessage').value.trim();
    if (!text) {
        showAlert('Por favor escribe un mensaje');
        return;
    }
    
    const me = currentUser();
    
    try {
        let supportMessages = JSON.parse(localStorage.getItem('supportMessages') || '[]');
        supportMessages.push({
            from: me.username,
            avatar: me.avatar,
            text: text,
            date: Date.now(),
            read: false,
            status: 'pending'
        });
        
        localStorage.setItem('supportMessages', JSON.stringify(supportMessages));
        syncToFirebase('supportMessages', supportMessages);
        document.getElementById('supportMessage').value = '';
        showAlert('✅ Mensaje enviado. El administrador lo revisará pronto.');
        loadSupportMessages();
    } catch (error) {
        showAlert('⚠️ Error al enviar mensaje: ' + error.message);
    }
}

function loadSupportMessages() {
    try {
        const supportMessages = JSON.parse(localStorage.getItem('supportMessages') || '[]');
        const container = document.getElementById('supportChatMessages');
        const me = currentUser();
        
        if (!container) return;
        container.innerHTML = '';
        
        if (supportMessages.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--muted-text); padding: 20px;">No hay mensajes aún</div>';
            return;
        }
        
        supportMessages.forEach(msg => {
            const msgDiv = document.createElement('div');
            msgDiv.style.cssText = `margin-bottom: 12px; padding: 10px; background: ${msg.from === me.username ? 'var(--accent)' : '#2b2d31'}; border-radius: 6px; word-wrap: break-word;`;
            msgDiv.innerHTML = `
                <div style="font-size: 12px; color: ${msg.from === me.username ? '#fff' : 'var(--muted-text)'}; margin-bottom: 4px;">
                    <strong>${msg.from}</strong> ${new Date(msg.date).toLocaleString()}
                </div>
                <div style="color: ${msg.from === me.username ? '#fff' : 'var(--text)'};">${msg.text}</div>
                ${msg.status === 'pending' ? '<div style="font-size: 11px; color: #ffa500; margin-top: 4px;">⏳ Pendiente</div>' : '<div style="font-size: 11px; color: #43b581; margin-top: 4px;">✅ Respondido</div>'}
            `;
            container.appendChild(msgDiv);
        });
        
        container.scrollTop = container.scrollHeight;
    } catch (error) {
        console.warn('Error loading support messages:', error);
    }
}

function loadAdminSupportPanel() {
    try {
        const supportMessages = JSON.parse(localStorage.getItem('supportMessages') || '[]');
        const container = document.getElementById('adminSupportList');
        
        if (!container) return;
        container.innerHTML = '';
        
        if (supportMessages.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--muted-text);">No hay mensajes de soporte</div>';
            return;
        }
        
        supportMessages.forEach((msg, index) => {
            const msgDiv = document.createElement('div');
            msgDiv.style.cssText = 'padding: 8px; border-bottom: 1px solid #444; margin-bottom: 8px;';
            msgDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: start; gap: 8px;">
                    <div style="flex: 1;">
                        <strong>${msg.from}</strong> - ${new Date(msg.date).toLocaleString()}
                        <div style="margin-top: 4px; color: #bbb; font-size: 12px;">${msg.text}</div>
                        <div style="margin-top: 4px;">
                            <span style="background: ${msg.status === 'pending' ? '#ff6600' : '#43b581'}; padding: 2px 6px; border-radius: 3px; font-size: 11px;">${msg.status === 'pending' ? 'Pendiente' : 'Respondido'}</span>
                        </div>
                    </div>
                    <button onclick="markSupportAsAnswered(${index})" style="padding: 4px 8px; background: #43b581; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; min-height: 24px;">✓ Marcar Respondido</button>
                </div>
            `;
            container.appendChild(msgDiv);
        });
    } catch (error) {
        console.warn('Error loading admin support panel:', error);
    }
}

function markSupportAsAnswered(index) {
    try {
        let supportMessages = JSON.parse(localStorage.getItem('supportMessages') || '[]');
        if (supportMessages[index]) {
            supportMessages[index].status = 'answered';
            localStorage.setItem('supportMessages', JSON.stringify(supportMessages));
            syncToFirebase('supportMessages', supportMessages);
            loadAdminSupportPanel();
            loadSupportMessages();
        }
    } catch (error) {
        showAlert('⚠️ Error: ' + error.message);
    }
}

// Ensure privateChats entries have consistent structure: { messages: [], unread: {} }
function normalizePrivateChats(chats) {
    if (!chats || typeof chats !== 'object') return {};
    Object.keys(chats).forEach(key => {
        let v = chats[key];
        if (!v) {
            chats[key] = { messages: [], unread: {} };
            return;
        }

        // If stored as an array (legacy), convert to { messages: [...], unread: {} }
        if (Array.isArray(v)) {
            chats[key] = { messages: v, unread: {} };
            return;
        }

        // If object has numeric keys (Firebase array-as-object), convert to array
        const allNumeric = Object.keys(v).length > 0 && Object.keys(v).every(k => !isNaN(Number(k)));
        if (allNumeric) {
            chats[key] = { messages: Object.values(v), unread: {} };
            return;
        }

        // If has messages field but it's an object, convert it to array
        if (v.messages && !Array.isArray(v.messages) && typeof v.messages === 'object') {
            try { v.messages = Object.values(v.messages); } catch (e) { v.messages = []; }
        }

        // Ensure unread exists
        if (!v.unread || typeof v.unread !== 'object') v.unread = {};
        // Ensure messages exists as array
        if (!v.messages || !Array.isArray(v.messages)) v.messages = v.messages ? [v.messages] : [];
        chats[key] = v;
    });
    return chats;
}

// Ensure groups entries have consistent structure: { name, privacy, members: [], messages: [], unread: {} }
function normalizeGroups(groups) {
    if (!Array.isArray(groups)) return [];
    groups.forEach((g, idx) => {
        if (!g) { groups[idx] = { name: '', privacy: 'public', members: [], messages: [], unread: {} }; return; }
        if (!Array.isArray(g.members)) g.members = Array.isArray(g.members) ? g.members : (g.members ? Object.values(g.members) : []);
        if (!g.messages) g.messages = [];
        if (!Array.isArray(g.messages) && typeof g.messages === 'object') {
            try { g.messages = Object.values(g.messages); } catch (e) { g.messages = []; }
        }
        if (!g.unread || typeof g.unread !== 'object') g.unread = {};
        groups[idx] = g;
    });
    return groups;
}

// Visual pulse for nav badges when a new message arrives
function showBadgePulseById(badgeId) {
    try {
        const el = document.getElementById(badgeId);
        if (!el) return;
        // Ensure visible
        el.style.display = el.textContent && Number(el.textContent) > 0 ? 'inline-block' : el.style.display || 'inline-block';
        el.classList.add('badge-pulse');
        setTimeout(() => { try { el.classList.remove('badge-pulse'); } catch(e){} }, 900);
    } catch (e) { console.warn('showBadgePulse error', e); }
}