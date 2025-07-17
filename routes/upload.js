const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const { validateFile, generateFilename, formatFileSize } = require('../utils/fileUtils');

const router = express.Router();

// Configuration Multer pour l'upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, process.env.UPLOAD_DIR || './uploads');
    },
    filename: (req, file, cb) => {
        const uniqueName = generateFilename(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: Infinity, // Pas de limite de taille
        fieldSize: Infinity,
        fields: Infinity,
        files: Infinity
    },
    fileFilter: (req, file, cb) => {
        const validation = validateFile(file);
        if (validation.isValid) {
            cb(null, true);
        } else {
            cb(new Error(validation.error), false);
        }
    }
});

// POST /api/upload - Upload simple de fichier
router.post('/', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false,
                error: 'Aucun fichier fourni' 
            });
        }

        const fileInfo = {
            id: uuidv4(),
            originalName: req.file.originalname,
            filename: req.file.filename,
            path: req.file.path,
            size: req.file.size,
            mimetype: req.file.mimetype,
            uploadedAt: new Date().toISOString()
        };

        console.log(`Fichier uploadé: ${req.file.originalname} (${formatFileSize(req.file.size)})`);

        res.json({
            success: true,
            message: 'Fichier uploadé avec succès',
            file: fileInfo
        });

    } catch (error) {
        console.error('Erreur lors de l\'upload:', error);
        
        // Nettoyer le fichier en cas d'erreur
        if (req.file && req.file.path) {
            try {
                await fs.remove(req.file.path);
            } catch (cleanupError) {
                console.error('Erreur lors du nettoyage:', cleanupError);
            }
        }

        res.status(500).json({
            success: false,
            error: 'Erreur lors de l\'upload',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne'
        });
    }
});

// POST /api/upload/validate - Valider un fichier avant upload
router.post('/validate', (req, res) => {
    const { filename, size, mimetype } = req.body;

    if (!filename || !size) {
        return res.status(400).json({
            success: false,
            error: 'Informations de fichier manquantes'
        });
    }

    // Créer un objet fichier fictif pour la validation
    const fakeFile = {
        originalname: filename,
        size: parseInt(size),
        mimetype: mimetype
    };

    const validation = validateFile(fakeFile);

    res.json({
        success: validation.isValid,
        valid: validation.isValid,
        error: validation.error
    });
});

// GET /api/upload/limits - Obtenir les limites d'upload
router.get('/limits', (req, res) => {
    const allowedExtensions = (process.env.ALLOWED_EXTENSIONS || 'mp4,avi,mov,mkv,webm,mp3,wav,m4a').split(',');

    res.json({
        success: true,
        limits: {
            maxFileSize: null, // Pas de limite
            maxFileSizeFormatted: 'Aucune limite',
            allowedExtensions: allowedExtensions,
            allowedMimeTypes: [
                'video/mp4',
                'video/avi',
                'video/quicktime',
                'video/x-msvideo',
                'video/x-matroska',
                'video/webm',
                'audio/mpeg',
                'audio/wav',
                'audio/mp4',
                'audio/x-m4a'
            ]
        }
    });
});

// DELETE /api/upload/:filename - Supprimer un fichier uploadé
router.delete('/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const filepath = path.join(process.env.UPLOAD_DIR || './uploads', filename);

        // Vérifier que le fichier existe
        if (!await fs.pathExists(filepath)) {
            return res.status(404).json({
                success: false,
                error: 'Fichier non trouvé'
            });
        }

        // Supprimer le fichier
        await fs.remove(filepath);

        console.log(`Fichier supprimé: ${filename}`);

        res.json({
            success: true,
            message: 'Fichier supprimé avec succès'
        });

    } catch (error) {
        console.error('Erreur lors de la suppression:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la suppression'
        });
    }
});

// GET /api/upload/status - Statut du système d'upload
router.get('/status', async (req, res) => {
    try {
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        const tempDir = process.env.TEMP_DIR || './temp';
        const downloadDir = process.env.DOWNLOAD_DIR || './public/downloads';

        // Vérifier que les dossiers existent
        const directories = await Promise.all([
            fs.pathExists(uploadDir),
            fs.pathExists(tempDir),
            fs.pathExists(downloadDir)
        ]);

        // Compter les fichiers dans chaque dossier
        const fileCounts = await Promise.all([
            fs.readdir(uploadDir).then(files => files.length).catch(() => 0),
            fs.readdir(tempDir).then(files => files.length).catch(() => 0),
            fs.readdir(downloadDir).then(files => files.length).catch(() => 0)
        ]);

        res.json({
            success: true,
            status: {
                directories: {
                    upload: directories[0],
                    temp: directories[1],
                    download: directories[2]
                },
                fileCounts: {
                    uploads: fileCounts[0],
                    temp: fileCounts[1],
                    downloads: fileCounts[2]
                },
                limits: {
                    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024,
                    allowedExtensions: (process.env.ALLOWED_EXTENSIONS || 'mp4,avi,mov,mkv,webm,mp3,wav,m4a').split(',')
                }
            }
        });

    } catch (error) {
        console.error('Erreur lors de la vérification du statut:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la vérification du statut'
        });
    }
});

// Middleware de gestion d'erreurs spécifique à multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Fichier trop volumineux',
                message: `Taille maximum autorisée: ${formatFileSize(parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024)}`
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Trop de fichiers'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                error: 'Champ de fichier inattendu'
            });
        }
    }

    // Autres erreurs de validation
    if (error.message) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }

    next(error);
});

module.exports = router;