const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

// Import des routes
const subtitleRoutes = require('./routes/subtitles');
const uploadRoutes = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

// CORRECTION 1: Configuration CORS plus stricte et spécifique
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'Content-Length', 
        'X-Requested-With',
        'Accept',
        'Origin'
    ],
    maxAge: 86400,
    optionsSuccessStatus: 200
}));

// CORRECTION 2: Middleware dans le bon ordre
// D'abord les fichiers statiques
app.use(express.static('public', {
    maxAge: '1d',
    etag: false
}));

// CORRECTION 3: Middleware pour gérer les requêtes multipart AVANT les parsers
app.use((req, res, next) => {
    // Loguer toutes les requêtes pour debug
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    
    // Vérifier les headers Content-Type
    const contentType = req.headers['content-type'] || '';
    
    if (contentType.includes('multipart/form-data')) {
        // Pour les uploads multipart, ne pas parser avec express.json/urlencoded
        console.log('📤 Requête multipart détectée, bypass des parsers JSON/URL');
        return next();
    }
    
    // Pour les autres requêtes, continuer normalement
    next();
});

// CORRECTION 4: Parsers JSON/URL seulement pour les requêtes non-multipart
app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    
    if (!contentType.includes('multipart/form-data')) {
        // Appliquer les parsers seulement si ce n'est pas multipart
        express.json({ 
            limit: '10gb',
            strict: true,
            type: ['application/json', 'text/json']
        })(req, res, () => {
            express.urlencoded({ 
                limit: '10gb', 
                extended: true,
                type: 'application/x-www-form-urlencoded'
            })(req, res, next);
        });
    } else {
        next();
    }
});

// CORRECTION 5: Middleware de protection contre les uploads en boucle
const uploadProtection = new Map();

app.use('/api/subtitles/generate', (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const clientKey = `${clientIP}-${userAgent}`;
    
    const now = Date.now();
    const lastUpload = uploadProtection.get(clientKey);
    
    // Bloquer si upload récent (moins de 5 secondes)
    if (lastUpload && (now - lastUpload) < 5000) {
        console.log(`🚫 Upload bloqué pour ${clientKey} (trop récent)`);
        return res.status(429).json({
            success: false,
            error: 'Upload trop fréquent, attendez 5 secondes entre les uploads'
        });
    }
    
    // Enregistrer le timestamp
    uploadProtection.set(clientKey, now);
    
    // Nettoyer les anciennes entrées (plus de 1 minute)
    for (const [key, timestamp] of uploadProtection.entries()) {
        if (now - timestamp > 60000) {
            uploadProtection.delete(key);
        }
    }
    
    next();
});

// Créer les dossiers nécessaires
const createDirectories = async () => {
    try {
        const dirs = ['./uploads', './temp', './public/downloads'];
        for (const dir of dirs) {
            await fs.ensureDir(dir);
            console.log(`📁 Dossier créé/vérifié: ${dir}`);
        }
        console.log('✅ Tous les dossiers sont prêts');
    } catch (error) {
        console.error('❌ Erreur lors de la création des dossiers:', error);
        throw error;
    }
};

// CORRECTION 6: Routes avec logging amélioré
app.use('/api/subtitles', (req, res, next) => {
    console.log(`🎯 Route subtitles: ${req.method} ${req.url}`);
    console.log(`📋 Content-Type: ${req.headers['content-type']}`);
    console.log(`📏 Content-Length: ${req.headers['content-length']}`);
    next();
}, subtitleRoutes);

app.use('/api/upload', (req, res, next) => {
    console.log(`📤 Route upload: ${req.method} ${req.url}`);
    next();
}, uploadRoutes);

// Route principale pour servir l'application
app.get('/', (req, res) => {
    console.log('🏠 Serving index.html');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// CORRECTION 7: Middleware de gestion d'erreurs amélioré
app.use((err, req, res, next) => {
    console.error(`💥 Erreur serveur: ${err.message}`);
    console.error(`📍 Route: ${req.method} ${req.url}`);
    console.error(`📋 Headers:`, req.headers);
    
    // Erreurs spécifiques multer
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            success: false,
            error: 'Fichier trop volumineux',
            code: 'FILE_TOO_LARGE'
        });
    }
    
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
            success: false,
            error: 'Champ de fichier inattendu',
            code: 'UNEXPECTED_FILE'
        });
    }
    
    // Erreur générique
    res.status(500).json({ 
        success: false,
        error: 'Erreur interne du serveur',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Une erreur est survenue',
        code: 'INTERNAL_ERROR'
    });
});

// Route 404 améliorée
app.use('*', (req, res) => {
    console.log(`🔍 Route non trouvée: ${req.method} ${req.url}`);
    res.status(404).json({ 
        success: false,
        error: 'Route non trouvée',
        code: 'NOT_FOUND'
    });
});

// Démarrage du serveur amélioré
const startServer = async () => {
    try {
        console.log('🚀 Démarrage du serveur...');
        
        // Créer les dossiers
        await createDirectories();
        
        // Vérifier la configuration OpenAI
        console.log('🔑 Vérification configuration OpenAI...');
        const SubtitleService = require('./services/SubtitleService');
        const subtitleService = new SubtitleService();
        const isConfigValid = await subtitleService.validateConfiguration();
        
        if (!isConfigValid) {
            console.error('❌ Configuration OpenAI invalide');
            console.error('💡 Vérifiez votre clé API dans le fichier .env:');
            console.error('   OPENAI_API_KEY=sk-votre-vraie-clé-ici');
            
            // Continuer quand même pour les tests
            console.log('⚠️ Serveur démarré en mode dégradé (sans OpenAI)');
        }
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🌐 Serveur démarré sur http://localhost:${PORT}`);
            console.log(`📊 Environnement: ${process.env.NODE_ENV || 'development'}`);
            console.log(`💾 Support des gros fichiers: ✅`);
            console.log(`🔐 Protection anti-spam: ✅`);
            if (isConfigValid) {
                console.log('🤖 OpenAI: ✅');
            } else {
                console.log('🤖 OpenAI: ❌ (mode dégradé)');
            }
            console.log('🎉 Serveur prêt !');
        });

        // CORRECTION 8: Configuration serveur pour gros fichiers
        server.timeout = 0; // Désactiver timeout global
        server.keepAliveTimeout = 300000; // 5 minutes
        server.headersTimeout = 310000; // 5 minutes + 10s
        server.requestTimeout = 0; // Pas de timeout sur les requêtes
        
        // Gestion des erreurs serveur
        server.on('error', (error) => {
            console.error('💥 Erreur serveur:', error);
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${PORT} déjà utilisé`);
                process.exit(1);
            }
        });
        
        server.on('clientError', (err, socket) => {
            console.error('💥 Erreur client:', err.message);
            if (err.code === 'ECONNRESET' || !socket.writable) {
                return;
            }
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        });

        return server;
        
    } catch (error) {
        console.error('💥 Erreur lors du démarrage:', error);
        process.exit(1);
    }
};

// Démarrage
startServer().catch((error) => {
    console.error('💥 Échec démarrage serveur:', error);
    process.exit(1);
});

// CORRECTION 9: Gestion propre de l'arrêt
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt du serveur...');
    
    try {
        // Nettoyer les fichiers temporaires
        const tempDir = './temp';
        if (await fs.pathExists(tempDir)) {
            const files = await fs.readdir(tempDir);
            console.log(`🧹 Nettoyage de ${files.length} fichier(s) temporaire(s)...`);
            await fs.emptyDir(tempDir);
            console.log('✅ Fichiers temporaires nettoyés');
        }
        
        // Nettoyer la protection upload
        uploadProtection.clear();
        console.log('✅ Protection upload nettoyée');
        
    } catch (error) {
        console.error('❌ Erreur lors du nettoyage:', error);
    }
    
    console.log('👋 Serveur arrêté proprement');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Signal SIGTERM reçu, arrêt...');
    process.emit('SIGINT');
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
    console.error('💥 Exception non capturée:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Rejection non gérée à:', promise, 'raison:', reason);
    process.exit(1);
});