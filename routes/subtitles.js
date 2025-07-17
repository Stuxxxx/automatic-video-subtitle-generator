const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const SubtitleService = require('../services/SubtitleService');
const VideoProcessor = require('../services/VideoProcessor');
const { validateFile, generateFilename } = require('../utils/fileUtils');

const router = express.Router();

// CORRECTION: Protection globale contre les uploads en double
const activeUploads = new Map();
const uploadHistory = new Map();

// CORRECTION: Configuration Multer renforcée
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const uploadDir = process.env.UPLOAD_DIR || './uploads';
            await fs.ensureDir(uploadDir);
            console.log(`📂 Destination d'upload: ${uploadDir}`);
            cb(null, uploadDir);
        } catch (error) {
            console.error('❌ Erreur création dossier upload:', error);
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        try {
            const uniqueName = generateFilename(file.originalname);
            console.log(`📝 Génération nom unique: ${file.originalname} -> ${uniqueName}`);
            cb(null, uniqueName);
        } catch (error) {
            console.error('❌ Erreur génération nom:', error);
            cb(error);
        }
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 * 1024, // 10GB max
        fieldSize: 100 * 1024 * 1024, // 100MB pour les champs
        fields: 10,
        files: 1, // UN SEUL fichier
        parts: 50
    },
    fileFilter: (req, file, cb) => {
        console.log(`🔍 Validation fichier: ${file.originalname} (${file.mimetype}, ${file.size || 'taille inconnue'})`);
        
        try {
            const validation = validateFile(file);
            if (validation.isValid) {
                console.log(`✅ Fichier validé: ${file.originalname}`);
                cb(null, true);
            } else {
                console.log(`❌ Fichier rejeté: ${validation.error}`);
                cb(new Error(validation.error), false);
            }
        } catch (error) {
            console.error('❌ Erreur validation:', error);
            cb(error, false);
        }
    }
});

// CORRECTION: Middleware de protection contre les uploads en double
const uploadProtectionMiddleware = async (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const clientKey = `${clientIP}-${userAgent}`;
    
    console.log(`🔒 Vérification protection upload pour: ${clientKey}`);
    
    const now = Date.now();
    
    // Vérifier les uploads actifs
    if (activeUploads.has(clientKey)) {
        const activeUpload = activeUploads.get(clientKey);
        console.log(`🚫 Upload déjà actif pour ${clientKey} depuis ${(now - activeUpload.startTime) / 1000}s`);
        
        return res.status(429).json({
            success: false,
            error: 'Un upload est déjà en cours pour ce client',
            code: 'UPLOAD_IN_PROGRESS',
            activeUploadId: activeUpload.jobId
        });
    }
    
    // Vérifier l'historique des uploads récents
    const lastUpload = uploadHistory.get(clientKey);
    if (lastUpload && (now - lastUpload) < 5000) {
        const remaining = Math.ceil((5000 - (now - lastUpload)) / 1000);
        console.log(`⏱️ Upload trop récent pour ${clientKey}, attendre ${remaining}s`);
        
        return res.status(429).json({
            success: false,
            error: `Upload trop fréquent, attendez ${remaining} seconde(s)`,
            code: 'RATE_LIMITED',
            waitSeconds: remaining
        });
    }
    
    // Nettoyer les anciennes entrées (plus de 1 heure)
    for (const [key, timestamp] of uploadHistory.entries()) {
        if (now - timestamp > 3600000) {
            uploadHistory.delete(key);
        }
    }
    
    // Marquer comme upload actif
    const jobId = uuidv4();
    activeUploads.set(clientKey, {
        jobId,
        startTime: now,
        clientIP,
        userAgent
    });
    
    req.uploadClientKey = clientKey;
    req.uploadJobId = jobId;
    
    console.log(`✅ Upload autorisé pour ${clientKey}, jobId: ${jobId}`);
    next();
};

// CORRECTION: Middleware de nettoyage en fin de requête
const cleanupUploadMiddleware = (req, res, next) => {
    const originalEnd = res.end;
    const originalSend = res.send;
    
    const cleanup = () => {
        if (req.uploadClientKey) {
            console.log(`🧹 Nettoyage upload pour ${req.uploadClientKey}`);
            
            // Retirer des uploads actifs
            activeUploads.delete(req.uploadClientKey);
            
            // Marquer dans l'historique
            uploadHistory.set(req.uploadClientKey, Date.now());
        }
    };
    
    res.end = function(...args) {
        cleanup();
        originalEnd.apply(this, args);
    };
    
    res.send = function(...args) {
        cleanup();
        originalSend.apply(this, args);
    };
    
    next();
};

// POST /api/subtitles/generate - Générer des sous-titres avec protection
router.post('/generate', 
    uploadProtectionMiddleware,
    cleanupUploadMiddleware,
    (req, res, next) => {
        console.log(`📨 Nouvelle requête de génération [${req.uploadJobId}]`);
        console.log(`📋 Client: ${req.uploadClientKey}`);
        console.log(`📊 Headers importants:`, {
            'content-type': req.headers['content-type']?.substring(0, 50),
            'content-length': req.headers['content-length'],
            'user-agent': req.headers['user-agent']?.substring(0, 100)
        });

        // Middleware d'upload avec gestion d'erreurs renforcée
        upload.single('video')(req, res, async (uploadError) => {
            if (uploadError) {
                console.error(`❌ Erreur upload multer [${req.uploadJobId}]:`, uploadError);
                
                let errorResponse = {
                    success: false,
                    error: 'Erreur lors de l\'upload',
                    code: 'UPLOAD_ERROR',
                    jobId: req.uploadJobId
                };
                
                // Messages d'erreur spécifiques
                if (uploadError.code === 'LIMIT_FILE_SIZE') {
                    errorResponse.error = 'Fichier trop volumineux (maximum 10GB)';
                    errorResponse.code = 'FILE_TOO_LARGE';
                    return res.status(413).json(errorResponse);
                } else if (uploadError.code === 'LIMIT_UNEXPECTED_FILE') {
                    errorResponse.error = 'Champ de fichier inattendu ou manquant';
                    errorResponse.code = 'UNEXPECTED_FILE';
                    return res.status(400).json(errorResponse);
                } else if (uploadError.code === 'LIMIT_FIELD_COUNT') {
                    errorResponse.error = 'Trop de champs dans la requête';
                    errorResponse.code = 'TOO_MANY_FIELDS';
                    return res.status(400).json(errorResponse);
                } else if (uploadError.message) {
                    errorResponse.error = uploadError.message;
                }
                
                return res.status(400).json(errorResponse);
            }

            // Continuer avec le traitement
            next();
        });
    }, 
    async (req, res) => {
        const jobId = req.uploadJobId;
        
        try {
            console.log(`🎬 Début traitement [${jobId}]`);
            
            // CORRECTION: Vérifications renforcées du fichier
            if (!req.file) {
                console.log(`❌ Aucun fichier reçu [${jobId}]`);
                return res.status(400).json({
                    success: false,
                    error: 'Aucun fichier vidéo fourni',
                    code: 'NO_FILE',
                    jobId: jobId
                });
            }

            // Vérifier que le fichier a bien été écrit
            if (!await fs.pathExists(req.file.path)) {
                console.log(`❌ Fichier non trouvé après upload [${jobId}]: ${req.file.path}`);
                return res.status(500).json({
                    success: false,
                    error: 'Fichier non sauvegardé correctement',
                    code: 'FILE_NOT_SAVED',
                    jobId: jobId
                });
            }

            // Vérifier la taille réelle du fichier
            const fileStats = await fs.stat(req.file.path);
            if (fileStats.size === 0) {
                console.log(`❌ Fichier vide détecté [${jobId}]: ${req.file.originalname}`);
                await fs.remove(req.file.path);
                return res.status(400).json({
                    success: false,
                    error: 'Le fichier uploadé est vide (0 bytes)',
                    code: 'EMPTY_FILE',
                    jobId: jobId
                });
            }

            // Log des informations du fichier
            console.log(`📁 Fichier traité [${jobId}]:`);
            console.log(`   - Nom original: ${req.file.originalname}`);
            console.log(`   - Nom fichier: ${req.file.filename}`);
            console.log(`   - Taille: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`   - Type MIME: ${req.file.mimetype}`);
            console.log(`   - Chemin: ${req.file.path}`);

            const { sourceLanguage = 'auto', targetLanguage = 'en' } = req.body;
            const videoPath = req.file.path;

            // Récupérer les métadonnées AVANT le traitement
            const videoProcessor = new VideoProcessor();
            let videoDuration = null;
            try {
                videoDuration = await videoProcessor.getVideoDuration(videoPath);
                console.log(`⏱️ Durée vidéo [${jobId}]: ${videoDuration}s`);
            } catch (error) {
                console.log(`⚠️ Impossible de récupérer la durée [${jobId}]: ${error.message}`);
                videoDuration = null;
            }

            // Stocker les informations du job pour le suivi de progression
            global.jobProgresses = global.jobProgresses || {};
            global.jobProgresses[jobId] = {
                status: 'extracting',
                progress: 0,
                message: 'Extraction de l\'audio...',
                totalSteps: 4,
                clientKey: req.uploadClientKey,
                startTime: Date.now()
            };

            // Étape 1: Vérifier et traiter la vidéo
            updateJobProgress(jobId, 'extracting', 25, 'Extraction de l\'audio...');
            const audioPath = await videoProcessor.extractAudio(videoPath, jobId);

            // Étape 2: Transcrire l'audio
            updateJobProgress(jobId, 'transcribing', 50, 'Transcription en cours...');
            const subtitleService = new SubtitleService();
            let transcription;
            
            try {
                // Passer le jobId pour le suivi de progression
                transcription = await subtitleService.transcribeAudio(audioPath, sourceLanguage, jobId);
            } catch (error) {
                console.log(`⚠️ API OpenAI indisponible [${jobId}]: ${error.message}`);
                console.log('🔄 Basculement vers le service alternatif...');
                
                const AlternativeSubtitleService = require('../services/AlternativeSubtitleService');
                const altService = new AlternativeSubtitleService();
                transcription = await altService.transcribeAudio(audioPath, sourceLanguage);
            }

            // Étape 3: Traduire si nécessaire
            updateJobProgress(jobId, 'translating', 75, 'Traduction...');
            let finalSubtitles = transcription;
            if (sourceLanguage !== targetLanguage && sourceLanguage !== 'auto') {
                finalSubtitles = await subtitleService.translateSubtitles(transcription, targetLanguage);
            }

            // Étape 4: Formater les sous-titres
            updateJobProgress(jobId, 'formatting', 90, 'Finalisation...');
            const formattedSubtitles = {
                srt: subtitleService.formatAsSrt(finalSubtitles),
                vtt: subtitleService.formatAsVtt(finalSubtitles),
                json: finalSubtitles
            };

            // Étape 5: Sauvegarder les fichiers
            const downloadUrls = await saveSubtitleFiles(formattedSubtitles, jobId);

            // Nettoyage des fichiers temporaires
            await cleanupTempFiles([videoPath, audioPath]);

            // Finaliser le job
            updateJobProgress(jobId, 'completed', 100, 'Terminé !');

            console.log(`✅ Traitement terminé avec succès [${jobId}]`);

            res.json({
                success: true,
                jobId: jobId,
                subtitles: finalSubtitles,
                downloads: downloadUrls,
                metadata: {
                    sourceLanguage: sourceLanguage,
                    targetLanguage: targetLanguage,
                    duration: videoDuration,
                    segmentCount: finalSubtitles.length,
                    fileSize: fileStats.size,
                    originalName: req.file.originalname
                }
            });

        } catch (error) {
            console.error(`💥 Erreur lors du traitement [${jobId}]:`, error);
            
            // Marquer le job comme échoué
            updateJobProgress(jobId, 'failed', 0, `Erreur: ${error.message}`);
            
            // Nettoyage en cas d'erreur
            if (req.file && req.file.path) {
                await cleanupTempFiles([req.file.path]);
            }

            res.status(500).json({
                success: false,
                error: 'Erreur lors de la génération des sous-titres',
                message: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne',
                code: 'PROCESSING_ERROR',
                jobId: jobId
            });
        }
    }
);

// GET /api/subtitles/status/:jobId - Vérifier le statut d'un job
router.get('/status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    
    try {
        const jobProgress = global.jobProgresses?.[jobId];
        
        if (!jobProgress) {
            return res.status(404).json({
                success: false,
                error: 'Job non trouvé',
                code: 'JOB_NOT_FOUND',
                jobId: jobId
            });
        }

        res.json({
            success: true,
            jobId: jobId,
            status: jobProgress.status,
            progress: jobProgress.progress,
            message: jobProgress.message,
            startTime: jobProgress.startTime
        });
    } catch (error) {
        console.error(`❌ Erreur vérification statut [${jobId}]:`, error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la vérification du statut',
            code: 'STATUS_ERROR',
            jobId: jobId
        });
    }
});

// GET /api/subtitles/download/:jobId/:format - Télécharger les sous-titres
router.get('/download/:jobId/:format', async (req, res) => {
    const { jobId, format } = req.params;
    
    try {
        console.log(`📥 Demande téléchargement: ${jobId}.${format}`);
        
        // Validation du format
        if (!['srt', 'vtt'].includes(format)) {
            return res.status(400).json({
                success: false,
                error: 'Format non supporté. Utilisez srt ou vtt.',
                code: 'INVALID_FORMAT'
            });
        }
        
        const filename = `${jobId}_subtitles.${format}`;
        const filepath = path.join(process.env.DOWNLOAD_DIR || './public/downloads', filename);
        
        if (!await fs.pathExists(filepath)) {
            console.log(`❌ Fichier non trouvé: ${filepath}`);
            return res.status(404).json({
                success: false,
                error: 'Fichier de sous-titres non trouvé',
                code: 'FILE_NOT_FOUND',
                jobId: jobId,
                format: format
            });
        }

        console.log(`✅ Téléchargement: ${filename}`);
        
        res.download(filepath, `subtitles.${format}`, (err) => {
            if (err) {
                console.error(`❌ Erreur téléchargement [${jobId}]:`, err);
                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        error: 'Erreur lors du téléchargement',
                        code: 'DOWNLOAD_ERROR'
                    });
                }
            } else {
                console.log(`✅ Téléchargement réussi: ${filename}`);
            }
        });
    } catch (error) {
        console.error(`💥 Erreur téléchargement [${jobId}]:`, error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du téléchargement',
            code: 'DOWNLOAD_ERROR'
        });
    }
});

// GET /api/subtitles/progress/:jobId - Suivre la progression d'un job (Server-Sent Events)
router.get('/progress/:jobId', (req, res) => {
    const { jobId } = req.params;
    
    console.log(`📊 Connexion SSE pour progression: ${jobId}`);
    
    // Headers pour Server-Sent Events
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Fonction pour envoyer les données de progression
    const sendProgress = () => {
        const jobProgress = global.jobProgresses?.[jobId];
        if (jobProgress) {
            res.write(`data: ${JSON.stringify(jobProgress)}\n\n`);
            
            // Fermer la connexion si le job est terminé ou a échoué
            if (jobProgress.status === 'completed' || jobProgress.status === 'failed') {
                console.log(`📊 SSE terminé pour ${jobId}: ${jobProgress.status}`);
                res.end();
                return false;
            }
        } else {
            // Job non trouvé
            res.write(`data: ${JSON.stringify({
                status: 'not_found',
                progress: 0,
                message: 'Job non trouvé',
                jobId: jobId
            })}\n\n`);
            res.end();
            return false;
        }
        return true;
    };

    // Envoyer la progression immédiatement
    if (!sendProgress()) return;

    // Puis toutes les 2 secondes
    const interval = setInterval(() => {
        if (!sendProgress()) {
            clearInterval(interval);
        }
    }, 2000);

    // Nettoyer quand la connexion se ferme
    req.on('close', () => {
        console.log(`📊 Connexion SSE fermée pour ${jobId}`);
        clearInterval(interval);
    });

    req.on('error', (error) => {
        console.error(`❌ Erreur SSE [${jobId}]:`, error);
        clearInterval(interval);
    });
});

// GET /api/subtitles/active - Lister les uploads actifs (pour debug)
router.get('/active', (req, res) => {
    const activeList = Array.from(activeUploads.entries()).map(([clientKey, data]) => ({
        clientKey,
        jobId: data.jobId,
        startTime: data.startTime,
        duration: Date.now() - data.startTime,
        clientIP: data.clientIP
    }));

    const historyList = Array.from(uploadHistory.entries()).map(([clientKey, timestamp]) => ({
        clientKey,
        lastUpload: timestamp,
        timeSince: Date.now() - timestamp
    }));

    res.json({
        success: true,
        activeUploads: activeList,
        uploadHistory: historyList,
        totalActive: activeUploads.size,
        totalHistory: uploadHistory.size
    });
});

// DELETE /api/subtitles/active/:clientKey - Forcer la suppression d'un upload actif (pour debug)
router.delete('/active/:clientKey', (req, res) => {
    const { clientKey } = req.params;
    
    if (activeUploads.has(clientKey)) {
        const uploadData = activeUploads.get(clientKey);
        activeUploads.delete(clientKey);
        
        console.log(`🗑️ Upload actif supprimé: ${clientKey} (${uploadData.jobId})`);
        
        res.json({
            success: true,
            message: 'Upload actif supprimé',
            removedUpload: uploadData
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Upload actif non trouvé',
            clientKey: clientKey
        });
    }
});

// Fonction utilitaire pour mettre à jour la progression
function updateJobProgress(jobId, status, progress, message) {
    global.jobProgresses = global.jobProgresses || {};
    global.jobProgresses[jobId] = {
        ...global.jobProgresses[jobId],
        status,
        progress,
        message,
        timestamp: new Date().toISOString(),
        lastUpdate: Date.now()
    };
    console.log(`📊 [${jobId}] Progression: ${progress}% - ${message}`);
}

// Fonction utilitaire pour sauvegarder les fichiers de sous-titres
async function saveSubtitleFiles(subtitles, jobId) {
    const downloadDir = process.env.DOWNLOAD_DIR || './public/downloads';
    await fs.ensureDir(downloadDir);
    
    console.log(`💾 Sauvegarde sous-titres [${jobId}] dans: ${downloadDir}`);
    
    const urls = {};
    
    for (const [format, content] of Object.entries(subtitles)) {
        if (format === 'json') continue;
        
        const filename = `${jobId}_subtitles.${format}`;
        const filepath = path.join(downloadDir, filename);
        
        try {
            await fs.writeFile(filepath, content, 'utf8');
            urls[format] = `/api/subtitles/download/${jobId}/${format}`;
            console.log(`✅ Fichier sauvegardé: ${filename} (${content.length} caractères)`);
        } catch (error) {
            console.error(`❌ Erreur sauvegarde ${filename}:`, error);
            throw new Error(`Impossible de sauvegarder le fichier ${format}`);
        }
    }
    
    return urls;
}

// Fonction utilitaire pour nettoyer les fichiers temporaires
async function cleanupTempFiles(files) {
    console.log(`🧹 Nettoyage de ${files.length} fichier(s) temporaire(s)...`);
    
    for (const file of files) {
        try {
            if (await fs.pathExists(file)) {
                const stats = await fs.stat(file);
                await fs.remove(file);
                console.log(`🗑️ Supprimé: ${path.basename(file)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            } else {
                console.log(`⚠️ Fichier déjà supprimé: ${path.basename(file)}`);
            }
        } catch (error) {
            console.error(`❌ Erreur suppression ${path.basename(file)}:`, error);
        }
    }
}

// Middleware de gestion d'erreurs spécifique à multer
router.use((error, req, res, next) => {
    console.error('💥 Erreur middleware subtitles:', error);
    
    // Nettoyer l'upload actif en cas d'erreur
    if (req.uploadClientKey) {
        console.log(`🧹 Nettoyage d'urgence pour: ${req.uploadClientKey}`);
        activeUploads.delete(req.uploadClientKey);
        uploadHistory.set(req.uploadClientKey, Date.now());
    }
    
    if (error instanceof multer.MulterError) {
        let errorResponse = {
            success: false,
            code: error.code,
            jobId: req.uploadJobId
        };
        
        switch (error.code) {
            case 'LIMIT_FILE_SIZE':
                errorResponse.error = 'Fichier trop volumineux';
                errorResponse.maxSize = '10GB';
                return res.status(413).json(errorResponse);
            case 'LIMIT_FILE_COUNT':
                errorResponse.error = 'Trop de fichiers (maximum 1)';
                return res.status(400).json(errorResponse);
            case 'LIMIT_UNEXPECTED_FILE':
                errorResponse.error = 'Champ de fichier inattendu';
                return res.status(400).json(errorResponse);
            case 'LIMIT_FIELD_COUNT':
                errorResponse.error = 'Trop de champs dans la requête';
                return res.status(400).json(errorResponse);
            default:
                errorResponse.error = error.message || 'Erreur Multer inconnue';
                return res.status(400).json(errorResponse);
        }
    }

    // Autres erreurs de validation
    if (error.message) {
        return res.status(400).json({
            success: false,
            error: error.message,
            code: 'VALIDATION_ERROR',
            jobId: req.uploadJobId
        });
    }

    next(error);
});

// Nettoyage périodique des jobs expirés
setInterval(() => {
    if (!global.jobProgresses) return;
    
    const now = Date.now();
    const expiredJobs = [];
    
    for (const [jobId, progress] of Object.entries(global.jobProgresses)) {
        // Supprimer les jobs de plus de 2 heures
        if (progress.startTime && (now - progress.startTime) > 2 * 60 * 60 * 1000) {
            expiredJobs.push(jobId);
        }
    }
    
    if (expiredJobs.length > 0) {
        console.log(`🧹 Nettoyage de ${expiredJobs.length} job(s) expiré(s)`);
        expiredJobs.forEach(jobId => {
            delete global.jobProgresses[jobId];
        });
    }
}, 30 * 60 * 1000); // Toutes les 30 minutes

module.exports = router;