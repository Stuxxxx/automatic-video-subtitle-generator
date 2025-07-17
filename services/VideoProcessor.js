const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

class VideoProcessor {
    constructor() {
        this.tempDir = process.env.TEMP_DIR || './temp';
    }

    /**
     * Extraire l'audio d'une vidéo avec logs détaillés
     */
    async extractAudio(videoPath, jobId) {
        return new Promise((resolve, reject) => {
            const audioPath = path.join(this.tempDir, `${jobId}_audio.wav`);
            
            console.log(`🎵 [${jobId}] Début extraction audio:`);
            console.log(`   - Entrée: ${videoPath}`);
            console.log(`   - Sortie: ${audioPath}`);
            
            // Vérifier l'espace disque avant de commencer
            this.checkAvailableSpace(this.tempDir).then(space => {
                if (space) {
                    console.log(`💾 [${jobId}] Espace disque: ${space}`);
                }
            });
            
            const startTime = Date.now();
            let lastProgress = 0;
            
            ffmpeg(videoPath)
                .audioCodec('pcm_s16le')
                .audioFrequency(16000)
                .audioChannels(1)
                .format('wav')
                .output(audioPath)
                .on('start', (commandLine) => {
                    console.log(`🔧 [${jobId}] Commande FFmpeg: ${commandLine}`);
                })
                .on('progress', (progress) => {
                    if (progress.percent && Math.floor(progress.percent) > lastProgress) {
                        lastProgress = Math.floor(progress.percent);
                        console.log(`📊 [${jobId}] Extraction audio: ${lastProgress}%`);
                        
                        if (progress.timemark) {
                            console.log(`   ⏱️ Temps traité: ${progress.timemark}`);
                        }
                        if (progress.currentKbps) {
                            console.log(`   📈 Débit: ${Math.floor(progress.currentKbps)} kbps`);
                        }
                        
                        // Mettre à jour la progression globale si elle existe
                        if (global.jobProgresses && global.jobProgresses[jobId]) {
                            const globalProgress = 25 + (progress.percent * 0.25); // 25-50% de la progression totale
                            global.jobProgresses[jobId].progress = Math.min(globalProgress, 50);
                            global.jobProgresses[jobId].message = `Extraction audio: ${lastProgress}%`;
                        }
                    }
                })
                .on('end', async () => {
                    const extractionTime = Date.now() - startTime;
                    console.log(`✅ [${jobId}] Extraction audio terminée en ${(extractionTime / 1000).toFixed(2)}s`);
                    
                    try {
                        // Vérifier que le fichier a été créé
                        const audioExists = await fs.pathExists(audioPath);
                        if (!audioExists) {
                            throw new Error('Fichier audio non créé');
                        }
                        
                        // Obtenir les statistiques du fichier audio
                        const audioStats = await fs.stat(audioPath);
                        const audioSizeMB = audioStats.size / (1024 * 1024);
                        console.log(`📁 [${jobId}] Fichier audio créé: ${audioSizeMB.toFixed(2)} MB`);
                        
                        // Vérifier la qualité audio
                        const audioInfo = await this.getAudioInfo(audioPath);
                        if (audioInfo) {
                            console.log(`🎧 [${jobId}] Qualité audio:`);
                            console.log(`   - Codec: ${audioInfo.codec}`);
                            console.log(`   - Fréquence: ${audioInfo.sampleRate} Hz`);
                            console.log(`   - Canaux: ${audioInfo.channels}`);
                            console.log(`   - Durée: ${audioInfo.duration ? Math.floor(audioInfo.duration) + 's' : 'inconnue'}`);
                        }
                        
                        resolve(audioPath);
                    } catch (verificationError) {
                        console.error(`❌ [${jobId}] Erreur vérification audio:`, verificationError);
                        reject(verificationError);
                    }
                })
                .on('error', (error) => {
                    const extractionTime = Date.now() - startTime;
                    console.error(`💥 [${jobId}] Erreur FFmpeg après ${(extractionTime / 1000).toFixed(2)}s:`, error);
                    console.error(`📋 [${jobId}] Détails erreur:`);
                    console.error(`   - Message: ${error.message}`);
                    console.error(`   - Code: ${error.code}`);
                    
                    // Nettoyer le fichier partiel si il existe
                    fs.pathExists(audioPath).then(exists => {
                        if (exists) {
                            fs.remove(audioPath).then(() => {
                                console.log(`🧹 [${jobId}] Fichier audio partiel supprimé`);
                            }).catch(cleanupError => {
                                console.error(`❌ [${jobId}] Erreur nettoyage:`, cleanupError);
                            });
                        }
                    });
                    
                    reject(new Error(`Erreur lors de l'extraction audio: ${error.message}`));
                })
                .run();
        });
    }

    /**
     * Obtenir les informations audio d'un fichier
     */
    async getAudioInfo(audioPath) {
        return new Promise((resolve) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) {
                    console.log(`⚠️ Impossible d'analyser l'audio: ${err.message}`);
                    resolve(null);
                    return;
                }
                
                const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
                if (audioStream) {
                    resolve({
                        codec: audioStream.codec_name,
                        sampleRate: audioStream.sample_rate,
                        channels: audioStream.channels,
                        duration: metadata.format.duration,
                        bitrate: audioStream.bit_rate
                    });
                } else {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Obtenir la durée d'une vidéo avec logs
     */
    async getVideoDuration(videoPath) {
        return new Promise((resolve, reject) => {
            console.log(`⏱️ Analyse durée: ${path.basename(videoPath)}`);
            
            // Vérifier que le fichier existe
            if (!require('fs').existsSync(videoPath)) {
                console.log(`⚠️ Fichier non trouvé pour durée: ${videoPath}`);
                resolve(null);
                return;
            }
            
            const startTime = Date.now();
            
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                const analysisTime = Date.now() - startTime;
                
                if (err) {
                    console.log(`⚠️ Erreur ffprobe pour ${path.basename(videoPath)} après ${analysisTime}ms: ${err.message}`);
                    resolve(null);
                    return;
                }
                
                const duration = metadata.format.duration;
                console.log(`✅ Durée analysée en ${analysisTime}ms: ${duration ? Math.floor(duration) + 's' : 'inconnue'}`);
                resolve(duration);
            });
        });
    }

    /**
     * Obtenir les informations complètes sur une vidéo avec logs détaillés
     */
    async getVideoInfo(videoPath) {
        return new Promise((resolve, reject) => {
            console.log(`🔍 Analyse métadonnées: ${path.basename(videoPath)}`);
            const startTime = Date.now();
            
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                const analysisTime = Date.now() - startTime;
                
                if (err) {
                    console.error(`❌ Erreur analyse métadonnées après ${analysisTime}ms:`, err.message);
                    reject(new Error(`Erreur lors de la lecture des métadonnées: ${err.message}`));
                    return;
                }
                
                console.log(`🔍 Métadonnées analysées en ${analysisTime}ms`);
                
                const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
                const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
                
                const info = {
                    duration: metadata.format.duration,
                    size: metadata.format.size,
                    bitrate: metadata.format.bit_rate,
                    format: metadata.format.format_name,
                    video: videoStream ? {
                        codec: videoStream.codec_name,
                        width: videoStream.width,
                        height: videoStream.height,
                        fps: videoStream.r_frame_rate ? eval(videoStream.r_frame_rate) : null
                    } : null,
                    audio: audioStream ? {
                        codec: audioStream.codec_name,
                        sampleRate: audioStream.sample_rate,
                        channels: audioStream.channels
                    } : null
                };
                
                console.log(`📊 Informations extraites:`);
                console.log(`   - Streams: ${metadata.streams.length} (${videoStream ? '1 vidéo' : '0 vidéo'}, ${audioStream ? '1 audio' : '0 audio'})`);
                console.log(`   - Format: ${info.format}`);
                console.log(`   - Taille: ${info.size ? (info.size / 1024 / 1024).toFixed(2) + ' MB' : 'inconnue'}`);
                
                resolve(info);
            });
        });
    }

    /**
     * Découper un fichier audio en segments avec logs détaillés
     */
    async splitAudioForProcessing(audioPath, segmentDuration = 180) {
        const segments = [];
        console.log(`✂️ Début division audio: ${path.basename(audioPath)}`);
        
        try {
            // Obtenir la durée totale
            const totalDuration = await this.getVideoDuration(audioPath);
            if (!totalDuration) {
                throw new Error('Impossible de déterminer la durée du fichier');
            }
            
            console.log(`⏱️ Durée totale: ${Math.floor(totalDuration)}s`);
            
            if (totalDuration <= segmentDuration) {
                console.log(`📁 Fichier assez petit (${Math.floor(totalDuration)}s ≤ ${segmentDuration}s), pas de division nécessaire`);
                return [{ path: audioPath, startTime: 0, duration: totalDuration, index: 0 }];
            }

            const numSegments = Math.ceil(totalDuration / segmentDuration);
            console.log(`🔢 Division en ${numSegments} segments de ${segmentDuration}s maximum`);
            
            const divisionStartTime = Date.now();
            
            for (let i = 0; i < numSegments; i++) {
                const startTime = i * segmentDuration;
                const actualDuration = Math.min(segmentDuration, totalDuration - startTime);
                
                const segmentPath = path.join(
                    this.tempDir,
                    `${path.basename(audioPath, '.wav')}_segment_${i}.wav`
                );
                
                console.log(`✂️ Segment ${i + 1}/${numSegments}: ${Math.floor(startTime)}s → ${Math.floor(startTime + actualDuration)}s (${Math.floor(actualDuration)}s)`);
                
                const segmentStartTime = Date.now();
                await this.extractAudioSegment(audioPath, segmentPath, startTime, actualDuration);
                const segmentTime = Date.now() - segmentStartTime;
                
                // Vérifier que le segment a été créé et qu'il fait moins de 25MB
                const segmentStats = await fs.stat(segmentPath);
                const segmentSizeMB = segmentStats.size / (1024 * 1024);
                console.log(`✅ Segment ${i + 1} créé en ${(segmentTime / 1000).toFixed(2)}s: ${segmentSizeMB.toFixed(2)} MB`);
                
                if (segmentStats.size > 25 * 1024 * 1024) {
                    console.log(`⚠️ Segment ${i + 1} encore trop gros (${segmentSizeMB.toFixed(2)} MB > 25 MB), re-division...`);
                    
                    // Si le segment est encore trop gros, le re-diviser
                    const subSegments = await this.splitAudioForProcessing(segmentPath, segmentDuration / 2);
                    
                    // Ajuster les timestamps des sous-segments
                    const adjustedSubSegments = subSegments.map(subSeg => ({
                        ...subSeg,
                        startTime: subSeg.startTime + startTime
                    }));
                    
                    segments.push(...adjustedSubSegments);
                    console.log(`🔄 Segment ${i + 1} re-divisé en ${subSegments.length} sous-segments`);
                    
                    // Supprimer le segment trop gros
                    await fs.remove(segmentPath);
                    console.log(`🗑️ Segment trop gros supprimé: ${path.basename(segmentPath)}`);
                } else {
                    segments.push({
                        path: segmentPath,
                        startTime: startTime,
                        duration: actualDuration,
                        index: i
                    });
                }
            }
            
            const divisionTime = Date.now() - divisionStartTime;
            console.log(`✅ Division terminée en ${(divisionTime / 1000).toFixed(2)}s: ${segments.length} segments créés`);
            
            // Statistiques finales
            const totalSegmentsSize = await this.calculateTotalSegmentsSize(segments);
            console.log(`📊 Taille totale des segments: ${totalSegmentsSize.toFixed(2)} MB`);
            
            return segments;
            
        } catch (error) {
            console.error('❌ Erreur lors de la division:', error);
            console.log(`🧹 Nettoyage des segments partiels...`);
            
            // Nettoyer les segments partiels en cas d'erreur
            for (const segment of segments) {
                try {
                    if (await fs.pathExists(segment.path)) {
                        await fs.remove(segment.path);
                        console.log(`🗑️ Segment partiel supprimé: ${path.basename(segment.path)}`);
                    }
                } catch (cleanupError) {
                    console.error(`❌ Erreur nettoyage segment:`, cleanupError);
                }
            }
            throw error;
        }
    }

    /**
     * Calculer la taille totale des segments
     */
    async calculateTotalSegmentsSize(segments) {
        let totalSize = 0;
        for (const segment of segments) {
            try {
                const stats = await fs.stat(segment.path);
                totalSize += stats.size;
            } catch (error) {
                console.error(`⚠️ Impossible de lire la taille de ${segment.path}:`, error);
            }
        }
        return totalSize / (1024 * 1024); // Convertir en MB
    }

    /**
     * Extraire un segment audio avec logs détaillés
     */
    async extractAudioSegment(inputPath, outputPath, startTime, duration) {
        return new Promise((resolve, reject) => {
            console.log(`🎵 Extraction segment: ${Math.floor(startTime)}s → ${Math.floor(startTime + duration)}s`);
            console.log(`   - Entrée: ${path.basename(inputPath)}`);
            console.log(`   - Sortie: ${path.basename(outputPath)}`);
            
            const extractionStartTime = Date.now();
            let lastProgress = 0;
            
            ffmpeg(inputPath)
                .seekInput(startTime)
                .duration(duration)
                .audioCodec('pcm_s16le')
                .audioFrequency(16000)
                .audioChannels(1)
                .format('wav')
                .output(outputPath)
                .on('start', (commandLine) => {
                    console.log(`🔧 Commande segment: ${commandLine}`);
                })
                .on('progress', (progress) => {
                    if (progress.percent && Math.floor(progress.percent) > lastProgress) {
                        lastProgress = Math.floor(progress.percent);
                        console.log(`📊 Progression segment: ${lastProgress}%`);
                        
                        if (progress.timemark) {
                            console.log(`   ⏱️ Temps segment: ${progress.timemark}`);
                        }
                    }
                })
                .on('end', async () => {
                    const extractionTime = Date.now() - extractionStartTime;
                    console.log(`✅ Segment extrait en ${(extractionTime / 1000).toFixed(2)}s: ${path.basename(outputPath)}`);
                    
                    // Vérifier que le segment a été créé
                    try {
                        const segmentExists = await fs.pathExists(outputPath);
                        if (!segmentExists) {
                            throw new Error('Segment non créé');
                        }
                        
                        const segmentStats = await fs.stat(outputPath);
                        console.log(`📁 Segment créé: ${(segmentStats.size / 1024 / 1024).toFixed(2)} MB`);
                        
                        resolve(outputPath);
                    } catch (verificationError) {
                        console.error(`❌ Erreur vérification segment:`, verificationError);
                        reject(verificationError);
                    }
                })
                .on('error', (error) => {
                    const extractionTime = Date.now() - extractionStartTime;
                    console.error(`💥 Erreur extraction segment après ${(extractionTime / 1000).toFixed(2)}s:`, error.message);
                    console.error(`📋 Détails erreur segment:`);
                    console.error(`   - Entrée: ${inputPath}`);
                    console.error(`   - Sortie: ${outputPath}`);
                    console.error(`   - Début: ${startTime}s`);
                    console.error(`   - Durée: ${duration}s`);
                    
                    // Nettoyer le segment partiel
                    fs.pathExists(outputPath).then(exists => {
                        if (exists) {
                            fs.remove(outputPath).then(() => {
                                console.log(`🧹 Segment partiel supprimé: ${path.basename(outputPath)}`);
                            }).catch(cleanupError => {
                                console.error(`❌ Erreur nettoyage segment:`, cleanupError);
                            });
                        }
                    });
                    
                    reject(new Error(`Erreur lors de l'extraction du segment: ${error.message}`));
                })
                .run();
        });
    }

    /**
     * Compresser un fichier audio pour réduire la taille
     */
    async compressAudio(audioPath, outputPath, quality = 2) {
        return new Promise((resolve, reject) => {
            console.log(`🗜️ Compression audio: ${path.basename(audioPath)}`);
            console.log(`   - Qualité: ${quality}`);
            console.log(`   - Sortie: ${path.basename(outputPath)}`);
            
            const compressionStartTime = Date.now();
            
            ffmpeg(audioPath)
                .audioCodec('libmp3lame')
                .audioBitrate('64k')
                .audioFrequency(16000)
                .audioChannels(1)
                .output(outputPath)
                .on('start', (commandLine) => {
                    console.log(`🔧 Commande compression: ${commandLine}`);
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        console.log(`📊 Compression: ${Math.floor(progress.percent)}%`);
                    }
                })
                .on('end', async () => {
                    const compressionTime = Date.now() - compressionStartTime;
                    console.log(`✅ Compression terminée en ${(compressionTime / 1000).toFixed(2)}s`);
                    
                    try {
                        const originalStats = await fs.stat(audioPath);
                        const compressedStats = await fs.stat(outputPath);
                        
                        const originalSizeMB = originalStats.size / (1024 * 1024);
                        const compressedSizeMB = compressedStats.size / (1024 * 1024);
                        const compressionRatio = ((originalStats.size - compressedStats.size) / originalStats.size * 100);
                        
                        console.log(`📊 Résultat compression:`);
                        console.log(`   - Original: ${originalSizeMB.toFixed(2)} MB`);
                        console.log(`   - Compressé: ${compressedSizeMB.toFixed(2)} MB`);
                        console.log(`   - Économie: ${compressionRatio.toFixed(1)}%`);
                        
                        resolve(outputPath);
                    } catch (statsError) {
                        console.error(`⚠️ Erreur lecture stats compression:`, statsError);
                        resolve(outputPath);
                    }
                })
                .on('error', (error) => {
                    const compressionTime = Date.now() - compressionStartTime;
                    console.error(`💥 Erreur compression après ${(compressionTime / 1000).toFixed(2)}s:`, error);
                    reject(new Error(`Erreur lors de la compression: ${error.message}`));
                })
                .run();
        });
    }

    /**
     * Nettoyer les fichiers temporaires avec logs
     */
    async cleanup(files) {
        console.log(`🧹 Nettoyage de ${files.length} fichier(s)...`);
        
        for (const file of files) {
            try {
                if (await fs.pathExists(file)) {
                    const stats = await fs.stat(file);
                    const sizeMB = stats.size / (1024 * 1024);
                    
                    await fs.remove(file);
                    console.log(`🗑️ Fichier supprimé: ${path.basename(file)} (${sizeMB.toFixed(2)} MB)`);
                } else {
                    console.log(`⚠️ Fichier déjà supprimé: ${path.basename(file)}`);
                }
            } catch (error) {
                console.error(`❌ Erreur suppression ${path.basename(file)}:`, error);
            }
        }
        
        console.log(`✅ Nettoyage terminé`);
    }

    /**
     * Vérifier si FFmpeg est disponible
     */
    async checkFFmpegAvailability() {
        return new Promise((resolve) => {
            console.log('🔍 Vérification disponibilité FFmpeg...');
            
            const ffmpegProcess = spawn('ffmpeg', ['-version']);
            let output = '';
            
            ffmpegProcess.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ FFmpeg disponible');
                    
                    // Extraire la version
                    const versionMatch = output.match(/ffmpeg version ([^\s]+)/);
                    if (versionMatch) {
                        console.log(`📋 Version FFmpeg: ${versionMatch[1]}`);
                    }
                    
                    resolve(true);
                } else {
                    console.error('❌ FFmpeg non disponible');
                    resolve(false);
                }
            });
            
            ffmpegProcess.on('error', (error) => {
                console.error('❌ Erreur lancement FFmpeg:', error.message);
                resolve(false);
            });
        });
    }

    /**
     * Normaliser l'audio pour améliorer la transcription
     */
    async normalizeAudio(audioPath) {
        const normalizedPath = audioPath.replace('.wav', '_normalized.wav');
        
        return new Promise((resolve, reject) => {
            console.log(`🔧 Normalisation audio: ${path.basename(audioPath)}`);
            
            const normalizationStartTime = Date.now();
            
            ffmpeg(audioPath)
                .audioFilters([
                    'highpass=f=80',     // Filtre passe-haut pour éliminer les basses fréquences
                    'lowpass=f=8000',    // Filtre passe-bas pour éliminer les hautes fréquences
                    'dynaudnorm=f=500:g=31'  // Normalisation dynamique
                ])
                .output(normalizedPath)
                .on('start', (commandLine) => {
                    console.log(`🔧 Commande normalisation: ${commandLine}`);
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        console.log(`📊 Normalisation: ${Math.floor(progress.percent)}%`);
                    }
                })
                .on('end', async () => {
                    const normalizationTime = Date.now() - normalizationStartTime;
                    console.log(`✅ Normalisation terminée en ${(normalizationTime / 1000).toFixed(2)}s`);
                    
                    try {
                        const originalStats = await fs.stat(audioPath);
                        const normalizedStats = await fs.stat(normalizedPath);
                        
                        console.log(`📊 Résultat normalisation:`);
                        console.log(`   - Original: ${(originalStats.size / 1024 / 1024).toFixed(2)} MB`);
                        console.log(`   - Normalisé: ${(normalizedStats.size / 1024 / 1024).toFixed(2)} MB`);
                        
                        resolve(normalizedPath);
                    } catch (statsError) {
                        console.error(`⚠️ Erreur lecture stats normalisation:`, statsError);
                        resolve(normalizedPath);
                    }
                })
                .on('error', (error) => {
                    const normalizationTime = Date.now() - normalizationStartTime;
                    console.error(`💥 Erreur normalisation après ${(normalizationTime / 1000).toFixed(2)}s:`, error);
                    reject(new Error(`Erreur lors de la normalisation: ${error.message}`));
                })
                .run();
        });
    }

    /**
     * Vérifier l'espace disque disponible
     */
    async checkAvailableSpace(directory) {
        try {
            const { execSync } = require('child_process');
            const isWindows = process.platform === 'win32';
            
            let output;
            if (isWindows) {
                // Commande Windows
                output = execSync(`fsutil volume diskfree "${directory}"`, { encoding: 'utf8' });
                const freeMatch = output.match(/(\d+)/);
                if (freeMatch) {
                    const freeBytes = parseInt(freeMatch[1]);
                    const freeGB = freeBytes / (1024 * 1024 * 1024);
                    return `${freeGB.toFixed(2)} GB disponibles`;
                }
            } else {
                // Commande Unix/Linux/macOS
                output = execSync(`df -h "${directory}"`, { encoding: 'utf8' });
                const lines = output.split('\n');
                if (lines.length > 1) {
                    const columns = lines[1].split(/\s+/);
                    if (columns.length >= 4) {
                        return `${columns[3]} disponibles`;
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error('⚠️ Erreur vérification espace disque:', error.message);
            return null;
        }
    }

    /**
     * Analyser la qualité audio d'un fichier
     */
    async analyzeAudioQuality(audioPath) {
        return new Promise((resolve) => {
            console.log(`🔍 Analyse qualité audio: ${path.basename(audioPath)}`);
            
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) {
                    console.error('❌ Erreur analyse qualité:', err.message);
                    resolve(null);
                    return;
                }
                
                const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
                if (!audioStream) {
                    console.error('❌ Pas de stream audio trouvé');
                    resolve(null);
                    return;
                }
                
                const quality = {
                    codec: audioStream.codec_name,
                    sampleRate: audioStream.sample_rate,
                    channels: audioStream.channels,
                    bitrate: audioStream.bit_rate,
                    duration: metadata.format.duration
                };
                
                console.log(`📊 Qualité audio analysée:`);
                console.log(`   - Codec: ${quality.codec}`);
                console.log(`   - Échantillonnage: ${quality.sampleRate} Hz`);
                console.log(`   - Canaux: ${quality.channels}`);
                console.log(`   - Débit: ${quality.bitrate ? Math.floor(quality.bitrate / 1000) + ' kbps' : 'inconnu'}`);
                console.log(`   - Durée: ${quality.duration ? Math.floor(quality.duration) + 's' : 'inconnue'}`);
                
                resolve(quality);
            });
        });
    }
}

module.exports = VideoProcessor;