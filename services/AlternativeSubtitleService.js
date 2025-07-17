const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

class AlternativeSubtitleService {
    constructor() {
        this.tempDir = process.env.TEMP_DIR || './temp';
    }

    /**
     * Transcrire avec Whisper local (si installé)
     */
    async transcribeWithLocalWhisper(audioPath, sourceLanguage = 'auto') {
        return new Promise((resolve, reject) => {
            console.log('🎤 Tentative de transcription avec Whisper local...');
            
            const args = [
                audioPath,
                '--output_format', 'json',
                '--verbose', 'False'
            ];
            
            if (sourceLanguage !== 'auto') {
                args.push('--language', sourceLanguage);
            }
            
            const whisperProcess = spawn('whisper', args);
            let output = '';
            let errorOutput = '';
            
            whisperProcess.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            whisperProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
                console.log('Whisper:', data.toString().trim());
            });
            
            whisperProcess.on('close', (code) => {
                if (code === 0) {
                    try {
                        // Lire le fichier JSON généré
                        const baseName = path.basename(audioPath, path.extname(audioPath));
                        const jsonPath = path.join(path.dirname(audioPath), `${baseName}.json`);
                        
                        if (fs.existsSync(jsonPath)) {
                            const result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                            const subtitles = this.convertWhisperLocalToSubtitles(result);
                            
                            // Nettoyer le fichier JSON temporaire
                            fs.removeSync(jsonPath);
                            
                            resolve(subtitles);
                        } else {
                            reject(new Error('Fichier de transcription non trouvé'));
                        }
                    } catch (error) {
                        reject(new Error(`Erreur lors du parsing: ${error.message}`));
                    }
                } else {
                    reject(new Error(`Whisper a échoué avec le code ${code}: ${errorOutput}`));
                }
            });
            
            whisperProcess.on('error', (error) => {
                reject(new Error(`Impossible de lancer Whisper: ${error.message}`));
            });
        });
    }

    /**
     * Vérifier si Whisper local est disponible
     */
    async checkLocalWhisperAvailability() {
        return new Promise((resolve) => {
            const whisperProcess = spawn('whisper', ['--help']);
            
            whisperProcess.on('close', (code) => {
                resolve(code === 0);
            });
            
            whisperProcess.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * Transcrire avec vosk (alternative offline)
     */
    async transcribeWithVosk(audioPath, sourceLanguage = 'en') {
        // Cette méthode nécessiterait l'installation de vosk-api
        // et des modèles de langue correspondants
        console.log('🎤 Transcription Vosk non implémentée');
        throw new Error('Transcription Vosk non disponible');
    }

    /**
     * Générer des sous-titres factices pour test
     */
    async generateDummySubtitles(audioPath) {
        console.log('🤖 Génération de sous-titres de test...');
        
        // Obtenir la durée du fichier audio
        const VideoProcessor = require('./VideoProcessor');
        const videoProcessor = new VideoProcessor();
        
        try {
            const duration = await videoProcessor.getVideoDuration(audioPath);
            const numSegments = Math.max(1, Math.floor(duration / 5)); // Un segment toutes les 5 secondes
            
            const dummySubtitles = [];
            for (let i = 0; i < numSegments; i++) {
                const start = i * 5;
                const end = Math.min((i + 1) * 5, duration);
                
                dummySubtitles.push({
                    index: i + 1,
                    start: start,
                    end: end,
                    text: `[Segment audio ${i + 1}] - Transcription non disponible`
                });
            }
            
            console.log(`✅ ${numSegments} segments de test générés`);
            return dummySubtitles;
            
        } catch (error) {
            // Fallback avec durée estimée
            return [{
                index: 1,
                start: 0,
                end: 30,
                text: "[Audio détecté] - Transcription non disponible"
            }];
        }
    }

    /**
     * Méthode principale de transcription avec fallback amélioré
     */
    async transcribeAudio(audioPath, sourceLanguage = 'auto') {
        console.log('🎵 Démarrage de la transcription alternative...');
        
        // 1. Essayer Whisper local si disponible
        const hasLocalWhisper = await this.checkLocalWhisperAvailability();
        if (hasLocalWhisper) {
            try {
                console.log('✅ Whisper local disponible, utilisation...');
                return await this.transcribeWithLocalWhisper(audioPath, sourceLanguage);
            } catch (error) {
                console.log(`⚠️ Whisper local a échoué: ${error.message}`);
            }
        } else {
            console.log('⚠️ Whisper local non disponible');
        }
        
        // 2. Générer des sous-titres de test intelligents
        console.log('📝 Génération de sous-titres de test...');
        return await this.generateIntelligentDummySubtitles(audioPath, sourceLanguage);
    }

    /**
     * Générer des sous-titres plus intelligents pour les tests
     */
    async generateIntelligentDummySubtitles(audioPath, sourceLanguage = 'auto') {
        console.log('🤖 Génération de sous-titres de test intelligents...');
        
        try {
            // Obtenir la durée du fichier audio
            const VideoProcessor = require('./VideoProcessor');
            const videoProcessor = new VideoProcessor();
            const duration = await videoProcessor.getVideoDuration(audioPath);
            
            console.log(`⏱️ Durée détectée: ${Math.floor(duration)}s`);
            
            // Créer des segments réalistes (tous les 3-5 secondes)
            const segments = [];
            let currentTime = 0;
            let segmentIndex = 1;
            
            // Messages de test variés selon la langue
            const testMessages = this.getTestMessages(sourceLanguage);
            
            while (currentTime < duration) {
                const segmentDuration = 3 + Math.random() * 2; // 3-5 secondes
                const endTime = Math.min(currentTime + segmentDuration, duration);
                
                // Choisir un message de test aléatoire
                const messageIndex = (segmentIndex - 1) % testMessages.length;
                const baseMessage = testMessages[messageIndex];
                
                segments.push({
                    index: segmentIndex,
                    start: currentTime,
                    end: endTime,
                    text: `${baseMessage} [${segmentIndex}]`
                });
                
                currentTime = endTime;
                segmentIndex++;
                
                // Éviter les segments trop nombreux
                if (segmentIndex > 50) break;
            }
            
            console.log(`✅ ${segments.length} segments de test générés pour ${Math.floor(duration)}s d'audio`);
            return segments;
            
        } catch (error) {
            console.log(`⚠️ Erreur lors de l'analyse audio: ${error.message}`);
            
            // Fallback ultime
            return this.getBasicDummySubtitles();
        }
    }

    /**
     * Messages de test selon la langue
     */
    getTestMessages(language) {
        const messages = {
            'fr': [
                "Ceci est un test de transcription",
                "L'audio a été détecté mais la transcription n'est pas disponible",
                "Segment audio en français",
                "Contenu audio non transcrit",
                "Parole détectée dans cette section"
            ],
            'en': [
                "This is a transcription test",
                "Audio detected but transcription unavailable", 
                "English audio segment",
                "Untranscribed audio content",
                "Speech detected in this section"
            ],
            'es': [
                "Esta es una prueba de transcripción",
                "Audio detectado pero transcripción no disponible",
                "Segmento de audio en español",
                "Contenido de audio no transcrito",
                "Habla detectada en esta sección"
            ],
            'auto': [
                "Audio segment detected",
                "Speech content placeholder",
                "Transcription test segment", 
                "Audio analysis complete",
                "Voice activity detected"
            ]
        };
        
        return messages[language] || messages['auto'];
    }

    /**
     * Sous-titres de base si tout échoue
     */
    getBasicDummySubtitles() {
        return [
            {
                index: 1,
                start: 0,
                end: 10,
                text: "[DEMO] Transcription OpenAI non disponible"
            },
            {
                index: 2, 
                start: 10,
                end: 20,
                text: "[DEMO] Ajoutez du crédit OpenAI pour la vraie transcription"
            },
            {
                index: 3,
                start: 20,
                end: 30,
                text: "[DEMO] Ou installez Whisper local: pip install openai-whisper"
            }
        ];
    }

    /**
     * Convertir le résultat Whisper local
     */
    convertWhisperLocalToSubtitles(whisperResult) {
        if (!whisperResult.segments) {
            return [{
                index: 1,
                start: 0,
                end: 30,
                text: whisperResult.text || "Transcription non disponible"
            }];
        }

        return whisperResult.segments.map((segment, index) => ({
            index: index + 1,
            start: segment.start,
            end: segment.end,
            text: segment.text.trim()
        }));
    }

    /**
     * Traduction simple (sans API)
     */
    async translateSubtitles(subtitles, targetLanguage = 'en') {
        console.log(`🌐 Traduction vers ${targetLanguage} non disponible (mode offline)`);
        
        // Pour le mode offline, on garde les sous-titres originaux
        // avec une note indiquant qu'ils ne sont pas traduits
        return subtitles.map(subtitle => ({
            ...subtitle,
            text: `[${targetLanguage.toUpperCase()}] ${subtitle.text}`
        }));
    }

    /**
     * Formater les sous-titres au format SRT
     */
    formatAsSrt(subtitles) {
        return subtitles.map(subtitle => {
            const startTime = this.formatTimestamp(subtitle.start);
            const endTime = this.formatTimestamp(subtitle.end);
            
            return `${subtitle.index}\n${startTime} --> ${endTime}\n${subtitle.text}\n`;
        }).join('\n');
    }

    /**
     * Formater les sous-titres au format VTT
     */
    formatAsVtt(subtitles) {
        const vttContent = subtitles.map(subtitle => {
            const startTime = this.formatTimestamp(subtitle.start, 'vtt');
            const endTime = this.formatTimestamp(subtitle.end, 'vtt');
            
            return `${startTime} --> ${endTime}\n${subtitle.text}\n`;
        }).join('\n');
        
        return `WEBVTT\n\n${vttContent}`;
    }

    /**
     * Formater un timestamp
     */
    formatTimestamp(seconds, format = 'srt') {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        
        const separator = format === 'vtt' ? '.' : ',';
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}${separator}${ms.toString().padStart(3, '0')}`;
    }

    /**
     * Instructions d'installation pour Whisper local
     */
    getWhisperInstallInstructions() {
        return `
🔧 Pour installer Whisper en local:

1. Installer Python et pip
2. Installer Whisper:
   pip install openai-whisper

3. Télécharger un modèle:
   whisper --model medium --language fr audio_test.wav

4. Utilisation:
   whisper audio.wav --language fr --output_format json

📖 Documentation: https://github.com/openai/whisper
        `;
    }
}

module.exports = AlternativeSubtitleService;