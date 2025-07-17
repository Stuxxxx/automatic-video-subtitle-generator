const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');

/**
 * Valider un fichier uploadé (sans limite de taille)
 */
function validateFile(file) {
    const allowedExtensions = (process.env.ALLOWED_EXTENSIONS || 'mp4,avi,mov,mkv,webm,mp3,wav,m4a').split(',');
    
    // Vérifier l'extension
    const extension = path.extname(file.originalname).toLowerCase().slice(1);
    if (!allowedExtensions.includes(extension)) {
        return {
            isValid: false,
            error: `Format de fichier non supporté. Formats acceptés: ${allowedExtensions.join(', ')}`
        };
    }
    
    // Vérifier le type MIME
    const allowedMimeTypes = [
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
    ];
    
    if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
        return {
            isValid: false,
            error: `Type MIME non supporté: ${file.mimetype}`
        };
    }
    
    return {
        isValid: true,
        error: null
    };
}

/**
 * Générer un nom de fichier unique
 */
function generateFilename(originalName) {
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension);
    const uniqueId = uuidv4();
    const timestamp = Date.now();
    
    // Nettoyer le nom de base
    const cleanBaseName = baseName
        .replace(/[^a-zA-Z0-9\-_]/g, '_')
        .substring(0, 50);
    
    return `${timestamp}_${uniqueId}_${cleanBaseName}${extension}`;
}

/**
 * Formater la taille d'un fichier
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Obtenir l'extension d'un fichier
 */
function getFileExtension(filename) {
    return path.extname(filename).toLowerCase().slice(1);
}

/**
 * Vérifier si un fichier est une vidéo
 */
function isVideoFile(filename) {
    const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'];
    const extension = getFileExtension(filename);
    return videoExtensions.includes(extension);
}

/**
 * Vérifier si un fichier est un audio
 */
function isAudioFile(filename) {
    const audioExtensions = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'];
    const extension = getFileExtension(filename);
    return audioExtensions.includes(extension);
}

/**
 * Nettoyer un nom de fichier
 */
function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 255);
}

/**
 * Créer une structure de dossiers sécurisée
 */
async function ensureDirectoryStructure() {
    const directories = [
        process.env.UPLOAD_DIR || './uploads',
        process.env.TEMP_DIR || './temp',
        process.env.DOWNLOAD_DIR || './public/downloads',
        './logs'
    ];
    
    for (const dir of directories) {
        try {
            await fs.ensureDir(dir);
        } catch (error) {
            console.error(`Erreur lors de la création du dossier ${dir}:`, error);
            throw error;
        }
    }
}

/**
 * Nettoyer les anciens fichiers temporaires
 */
async function cleanupOldFiles(directory, maxAgeHours = 24) {
    try {
        const files = await fs.readdir(directory);
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000;
        
        for (const file of files) {
            const filepath = path.join(directory, file);
            const stats = await fs.stat(filepath);
            
            if (now - stats.mtime.getTime() > maxAge) {
                await fs.remove(filepath);
                console.log(`Fichier ancien supprimé: ${filepath}`);
            }
        }
    } catch (error) {
        console.error(`Erreur lors du nettoyage de ${directory}:`, error);
    }
}

/**
 * Calculer le hash d'un fichier
 */
async function calculateFileHash(filepath) {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filepath);
    
    return new Promise((resolve, reject) => {
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Vérifier l'espace disque disponible
 */
async function checkDiskSpace(directory) {
    const { execSync } = require('child_process');
    
    try {
        // Commande différente selon l'OS
        const isWindows = process.platform === 'win32';
        const command = isWindows 
            ? `dir /-c "${directory}"` 
            : `df -h "${directory}"`;
        
        const output = execSync(command, { encoding: 'utf8' });
        
        // Parsing basique - à améliorer selon les besoins
        return {
            available: true,
            details: output
        };
    } catch (error) {
        console.error('Erreur lors de la vérification de l\'espace disque:', error);
        return {
            available: false,
            error: error.message
        };
    }
}

module.exports = {
    validateFile,
    generateFilename,
    formatFileSize,
    getFileExtension,
    isVideoFile,
    isAudioFile,
    sanitizeFilename,
    ensureDirectoryStructure,
    cleanupOldFiles,
    calculateFileHash,
    checkDiskSpace
};