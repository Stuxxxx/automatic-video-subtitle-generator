const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const axios = require('axios');
const FormData = require('form-data');

class SubtitleService {
    constructor() {
        // Configuration OpenAI optimisée
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 900000, // 15 minutes
            maxRetries: 0,
            httpAgent: new https.Agent({
                keepAlive: true,
                timeout: 120000,
                maxSockets: 10,
                secureProtocol: 'TLSv1_2_method',
                rejectUnauthorized: true
            })
        });

        // Circuit breaker
        this.circuitBreaker = {
            failures: 0,
            threshold: 5,
            timeout: 300000,
            lastFailure: null,
            state: 'CLOSED'
        };

        // Configuration spéciale pour contenus adultes
        this.adultContentConfig = {
            enableAdultTerms: true,
            preserveIntimateContext: true,
            explicitLanguageSupport: true,
            emotionalNuanceDetection: true
        };
    }

    /**
     * Circuit breaker - Vérification d'état
     */
    checkCircuitBreaker() {
        if (this.circuitBreaker.state === 'OPEN') {
            const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailure;
            if (timeSinceLastFailure > this.circuitBreaker.timeout) {
                this.circuitBreaker.state = 'HALF_OPEN';
                console.log('🔄 Circuit breaker: Passage en mode HALF_OPEN');
            } else {
                throw new Error('Circuit breaker ouvert - Service temporairement indisponible');
            }
        }
    }

    /**
     * Enregistrer succès/échec pour circuit breaker
     */
    recordResult(success) {
        if (success) {
            this.circuitBreaker.failures = 0;
            this.circuitBreaker.state = 'CLOSED';
        } else {
            this.circuitBreaker.failures++;
            this.circuitBreaker.lastFailure = Date.now();
            if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
                this.circuitBreaker.state = 'OPEN';
                console.log('⚠️ Circuit breaker ouvert après trop d\'échecs');
            }
        }
    }

    /**
     * Transcription OpenAI avec gestion spéciale contenus adultes - VERSION TRÈS PERMISSIVE
     */
    async transcribeWithOpenAI(audioPath, sourceLanguage = 'auto') {
        const maxRetries = 5;
        let lastError = null;

        // Vérification taille fichier
        const stats = await fs.stat(audioPath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        console.log(`📁 Taille: ${fileSizeInMB.toFixed(2)} MB`);

        // Division automatique si fichier > 20MB
        if (stats.size > 20 * 1024 * 1024) {
            console.log('📂 Fichier volumineux, division en segments...');
            return await this.transcribeAudioInChunks(audioPath, sourceLanguage);
        }

        // Transcription normale
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.checkCircuitBreaker();
                
                console.log(`🎤 Transcription OpenAI PERMISSIVE (tentative ${attempt}/${maxRetries})`);

                // Paramètres TRÈS PERMISSIFS pour maximiser le contenu
                const transcriptionParams = {
                    file: fs.createReadStream(audioPath),
                    model: 'whisper-1',
                    response_format: 'verbose_json',
                    timestamp_granularities: ['segment'],
                    
                    // Paramètres ULTRA-PERMISSIFS
                    temperature: 0.3, // Plus créatif pour capter plus de nuances
                    condition_on_previous_text: true, // Continuité importante
                    no_speech_threshold: 0.5, // TRÈS sensible pour tout capter
                    logprob_threshold: -1.2, // TRÈS permissif
                    compression_ratio_threshold: 3.0, // Plus de répétitions tolérées
                    
                    word_timestamps: true,
                    vad_filter: false, // DÉSACTIVÉ pour ne rien rater
                    // vad_parameters supprimés pour être plus permissif
                };

                // Prompts spécialisés selon le type de contenu (SANS contaminer la transcription)
                if (sourceLanguage !== 'auto') {
                    transcriptionParams.language = sourceLanguage;
                    console.log(`🌐 Langue forcée: ${sourceLanguage}`);
                    // NE PAS ajouter de prompt qui pourrait contaminer la transcription
                } else {
                    // PAS de prompt pour éviter la contamination
                    console.log(`🌐 Détection automatique de langue`);
                }

                const response = await this.openai.audio.transcriptions.create(transcriptionParams);
                
                this.recordResult(true);
                let subtitles = this.convertWhisperToSubtitles(response);
                
                // Nettoyage adaptatif ultra-permissif
                subtitles = this.intelligentContentCleaning(subtitles, sourceLanguage);
                
                // Validation qualité TRÈS PERMISSIVE
                const qualityStats = this.validateSubtitleQuality(subtitles);
                
                // Rejeter SEULEMENT si VRAIMENT catastrophique (80% de segments suspects)
                if (qualityStats.suspiciousSegments > qualityStats.totalSegments * 0.8) {
                    console.log(`⚠️ Qualité VRAIMENT insuffisante (${qualityStats.suspiciousSegments}/${qualityStats.totalSegments} segments vraiment suspects)`);
                    if (attempt < maxRetries) {
                        throw new Error('Qualité de transcription vraiment catastrophique, retry...');
                    }
                }
                
                console.log(`✅ Transcription réussie: ${subtitles.length} segments (qualité: ${((1 - qualityStats.suspiciousSegments / qualityStats.totalSegments) * 100).toFixed(1)}%)`);
                return subtitles;

            } catch (error) {
                lastError = error;
                this.recordResult(false);
                console.error(`❌ Tentative ${attempt} échouée:`, error.message);

                if (this.isRetryableError(error)) {
                    if (attempt < maxRetries) {
                        const delay = this.calculateBackoffDelay(attempt);
                        console.log(`⏳ Attente ${delay/1000}s avant nouvelle tentative...`);
                        await this.sleep(delay);
                        continue;
                    }
                } else {
                    throw error;
                }
            }
        }

        throw new Error(`Échec après ${maxRetries} tentatives: ${lastError.message}`);
    }

    /**
     * Prompts spécialisés pour différents types de contenu
     */
    getContentAwarePrompt(language) {
        const prompts = {
            'en': "Transcribe all spoken content accurately, including intimate expressions, emotional sounds, and adult content. Preserve natural speech patterns, whispers, and emotional context.",
            'fr': "Transcrire tout le contenu parlé avec précision, y compris les expressions intimes, les sons émotionnels et le contenu adulte. Préserver les patterns naturels de la parole, les murmures et le contexte émotionnel.",
            'es': "Transcribir todo el contenido hablado con precisión, incluyendo expresiones íntimas, sonidos emocionales y contenido adulto. Preservar los patrones naturales del habla, susurros y contexto emocional.",
            'de': "Transkribieren Sie alle gesprochenen Inhalte genau, einschließlich intimer Ausdrücke, emotionaler Geräusche und Erwachseneninhalte. Bewahren Sie natürliche Sprachmuster, Flüstern und emotionalen Kontext.",
            'ru': "Точно транскрибировать все устное содержание, включая интимные выражения, эмоциональные звуки и взрослый контент. Сохранять естественные речевые паттерны, шепот и эмоциональный контекст.",
            'it': "Trascrivere accuratamente tutto il contenuto parlato, incluse espressioni intime, suoni emotivi e contenuto per adulti. Preservare i pattern naturali del parlato, sussurri e contesto emotivo.",
            'pt': "Transcrever com precisão todo o conteúdo falado, incluindo expressões íntimas, sons emocionais e conteúdo adulto. Preservar padrões naturais de fala, sussurros e contexto emocional."
        };
        
        return prompts[language] || prompts['en'];
    }

    getUniversalPrompt() {
        return "Accurately transcribe all spoken content including emotional expressions, intimate language, and adult content. Preserve the natural emotional context and speech patterns.";
    }

    /**
     * Nettoyage intelligent adaptatif selon le contenu - VERSION ULTRA-PERMISSIVE
     */
    intelligentContentCleaning(subtitles, expectedLanguage) {
        console.log('🧹 Nettoyage ULTRA-PERMISSIF du contenu...');
        
        // Analyse préliminaire du type de contenu
        const contentAnalysis = this.analyzeContentType(subtitles);
        console.log(`🔍 Type de contenu détecté: ${contentAnalysis.type} (confiance: ${(contentAnalysis.confidence * 100).toFixed(1)}%)`);
        
        const cleanedSubtitles = subtitles.filter((subtitle, index) => {
            const text = subtitle.text.trim();
            
            // Supprimer SEULEMENT les segments complètement vides
            if (!text || text.length === 0) {
                return false;
            }
            
            // NETTOYER d'abord les artefacts de prompt
            const promptArtifacts = [
                /preserve.*natural.*emotional.*context/i,
                /transcribe.*accurately/i,
                /including.*intimate.*expressions/i,
                /emotional.*sounds.*adult.*content/i,
                /speech.*patterns/i,
                /whispers.*emotional.*context/i,
                /^accurately transcribe/i,
                /^transcribe all spoken/i
            ];
            
            const isPromptArtifact = promptArtifacts.some(pattern => pattern.test(text));
            if (isPromptArtifact) {
                console.log(`🚫 Artefact de prompt supprimé: "${text}"`);
                return false;
            }
            
            // SEULS LES FILTRES LES PLUS STRICTS - Garder presque tout
            
            // 1. Supprimer SEULEMENT les répétitions ÉVIDENTES et LONGUES (10+ fois)
            if (this.isExtremeRepetition(text)) {
                console.log(`🚫 Répétition extrême: "${text}"`);
                return false;
            }
            
            // 2. Supprimer SEULEMENT les hallucinations techniques évidentes
            if (this.isClearTechnicalHallucination(text)) {
                console.log(`🚫 Hallucination technique évidente: "${text}"`);
                return false;
            }
            
            // 3. Supprimer SEULEMENT les segments VRAIMENT trop longs (plus de 60 secondes)
            if (this.isExtremelyLongSegment(subtitle)) {
                console.log(`🚫 Segment extrêmement long: ${subtitle.end - subtitle.start}s`);
                return false;
            }
            
            // TOUT LE RESTE EST CONSERVÉ - y compris:
            // - Sons comme "Rawr!"
            // - Expressions courtes répétées quelques fois
            // - Murmures et gémissements
            // - Expressions intimes
            // - Mots inventés qui pourraient être légitimes
            
            return true; // GARDER PAR DÉFAUT
        });
        
        // Post-traitement: amélioration de la cohérence émotionnelle (très permissif)
        const improvedSubtitles = this.improveEmotionalCoherencePermissive(cleanedSubtitles, contentAnalysis.type);
        
        // Réindexation finale
        const finalSubtitles = improvedSubtitles.map((subtitle, index) => ({
            ...subtitle,
            index: index + 1
        }));
        
        const removedCount = subtitles.length - finalSubtitles.length;
        console.log(`🧹 Mode ULTRA-PERMISSIF: seulement ${removedCount} segments supprimés (${((removedCount / subtitles.length) * 100).toFixed(1)}%)`);
        console.log(`✅ ${finalSubtitles.length} segments conservés (${((finalSubtitles.length / subtitles.length) * 100).toFixed(1)}%)`);
        
        return finalSubtitles;
    }

    /**
     * Détecter SEULEMENT les répétitions VRAIMENT extrêmes
     */
    isExtremeRepetition(text) {
        const words = text.split(/\s+/);
        
        // Répétition d'un mot plus de 10 fois
        if (words.length > 10) {
            const uniqueWords = [...new Set(words)];
            if (uniqueWords.length === 1) {
                return true;
            }
        }
        
        // Patterns vraiment évidents (plus de 8 répétitions)
        const extremePatterns = [
            /^(.{1,5})\1{8,}$/, // Même motif répété 9+ fois
            /^(no|да|nein|non|não)\s*\1{8,}$/i, // "No no no..." 9+ fois
        ];
        
        return extremePatterns.some(pattern => pattern.test(text));
    }

    /**
     * Détecter SEULEMENT les hallucinations techniques ÉVIDENTES
     */
    isClearTechnicalHallucination(text) {
        const clearTechnicalPatterns = [
            /^\[МУЗЫКА\]$/i,
            /^\[MUSIC\]$/i,
            /^\[INSTRUMENTAL\]$/i,
            /^\[APPLAUSE\]$/i,
            /^\[АПЛОДИСМЕНТЫ\]$/i,
            /^\[SILENCE\]$/i,
            /^\[ТИШИНА\]$/i,
            /^♪.*♪$/,  // Symboles musicaux
            /^(BACKGROUND MUSIC|FOND MUSICAL)$/i
        ];
        
        return clearTechnicalPatterns.some(pattern => pattern.test(text.trim()));
    }

    /**
     * Détecter SEULEMENT les segments VRAIMENT trop longs
     */
    isExtremelyLongSegment(subtitle) {
        const duration = subtitle.end - subtitle.start;
        // Seulement supprimer si plus de 60 secondes (au lieu de 30)
        return duration > 60;
    }

    /**
     * Amélioration émotionnelle TRÈS permissive
     */
    improveEmotionalCoherencePermissive(subtitles, contentType) {
        console.log('💕 Amélioration émotionnelle PERMISSIVE...');
        
        // Fusionner SEULEMENT les segments identiques très proches
        const improved = [];
        let currentSegment = null;
        
        for (const subtitle of subtitles) {
            if (!currentSegment) {
                currentSegment = { ...subtitle };
                continue;
            }
            
            // Fusionner SEULEMENT si texte identique ET gap < 1 seconde
            if (this.shouldMergeIdenticalOnly(currentSegment, subtitle)) {
                console.log(`💕 Fusion identique: "${currentSegment.text}" + "${subtitle.text}"`);
                currentSegment.end = subtitle.end;
                // Garder le texte le plus long des deux
                if (subtitle.text.length > currentSegment.text.length) {
                    currentSegment.text = subtitle.text;
                }
            } else {
                improved.push(currentSegment);
                currentSegment = { ...subtitle };
            }
        }
        
        if (currentSegment) {
            improved.push(currentSegment);
        }
        
        return improved;
    }

    /**
     * Fusionner SEULEMENT les segments vraiment identiques
     */
    shouldMergeIdenticalOnly(seg1, seg2) {
        const gap = seg2.start - seg1.end;
        const text1 = seg1.text.trim().toLowerCase();
        const text2 = seg2.text.trim().toLowerCase();
        
        // Fusionner SEULEMENT si texte identique ET gap très court
        return gap < 1 && text1 === text2;
    }

    /**
     * Analyser le type de contenu
     */
    analyzeContentType(subtitles) {
        const allText = subtitles.map(s => s.text.toLowerCase()).join(' ');
        const wordCount = allText.split(/\s+/).length;
        
        // Mots-clés pour contenu adulte/intime
        const adultKeywords = [
            // Anglais
            'love', 'baby', 'honey', 'darling', 'kiss', 'touch', 'feel', 'want', 'need', 'desire',
            'beautiful', 'gorgeous', 'sexy', 'hot', 'pleasure', 'passion', 'intimate', 'close',
            'moan', 'whisper', 'breathe', 'gasp', 'sigh', 'mmm', 'ahh', 'ohh', 'yes', 'more',
            // Français  
            'amour', 'chéri', 'bébé', 'ma belle', 'embrasser', 'toucher', 'sentir', 'vouloir',
            'désir', 'passion', 'plaisir', 'intime', 'proche', 'gémir', 'murmurer', 'respirer',
            'soupirer', 'oui', 'encore', 'plus',
            // Expressions communes
            'i love you', 'je t\'aime', 'come here', 'viens ici', 'so good', 'c\'est bon'
        ];
        
        // Mots-clés conversationnels
        const conversationalKeywords = [
            'hello', 'hi', 'how', 'what', 'where', 'when', 'why', 'think', 'know', 'say',
            'tell', 'ask', 'answer', 'question', 'talk', 'speak', 'listen', 'hear',
            'salut', 'bonjour', 'comment', 'quoi', 'où', 'quand', 'pourquoi', 'penser',
            'savoir', 'dire', 'parler', 'écouter', 'entendre'
        ];
        
        // Compter les occurrences
        let adultScore = 0;
        let conversationalScore = 0;
        
        adultKeywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            const matches = allText.match(regex) || [];
            adultScore += matches.length;
        });
        
        conversationalKeywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            const matches = allText.match(regex) || [];
            conversationalScore += matches.length;
        });
        
        // Normaliser par rapport au nombre total de mots
        const adultRatio = adultScore / wordCount;
        const conversationalRatio = conversationalScore / wordCount;
        
        // Déterminer le type dominant
        if (adultRatio > 0.05) { // 5% de mots intimes
            return { type: 'adult', confidence: Math.min(adultRatio * 10, 1) };
        } else if (conversationalRatio > 0.1) { // 10% de mots conversationnels
            return { type: 'conversation', confidence: Math.min(conversationalRatio * 5, 1) };
        } else {
            return { type: 'general', confidence: 0.5 };
        }
    }

    /**
     * Nettoyage spécialisé pour contenu adulte
     */
    cleanAdultContent(text, subtitle, index, subtitles, expectedLanguage) {
        // Être TRÈS permissif avec le contenu adulte légitime
        
        // Supprimer seulement les répétitions excessives obvies
        if (this.isObviousRepetition(text)) {
            console.log(`🚫 Répétition évidente: "${text}"`);
            return false;
        }
        
        // Supprimer les hallucinations techniques évidentes
        if (this.isTechnicalHallucination(text)) {
            console.log(`🚫 Hallucination technique: "${text}"`);
            return false;
        }
        
        // Garder les expressions émotionnelles légitimes
        if (this.isLegitimateEmotionalExpression(text)) {
            return true;
        }
        
        // Garder les murmures et sons intimes
        if (this.isIntimateSound(text)) {
            return true;
        }
        
        // Test de longueur de segment plus permissif
        if (this.isSegmentTooLongForAdult(subtitle)) {
            console.log(`🚫 Segment trop long pour contexte adulte: ${subtitle.end - subtitle.start}s`);
            return false;
        }
        
        return true; // Par défaut, garder le contenu adulte
    }

    /**
     * Expressions émotionnelles légitimes - VERSION ULTRA-PERMISSIVE
     */
    isLegitimateEmotionalExpression(text) {
        // ACCEPTER BEAUCOUP PLUS de types d'expressions
        const emotionalPatterns = [
            // Sons et expressions intimes légitimes
            /^(oh|ah|mm|ohh|ahh|mmm|yes|oui|si|da|ja)+$/i,
            /^(baby|honey|darling|chéri|amor|amore)+$/i,
            /^(more|encore|más|mehr|di più|больше)+$/i,
            /^(please|s'il te plaît|por favor|bitte|per favore|пожалуйста)+$/i,
            /^(good|bon|bueno|gut|bene|хорошо)+$/i,
            /^(like that|comme ça|así|so|così|вот так)+$/i,
            /^(don't stop|ne t'arrête pas|no pares|hör nicht auf|non fermarti|не останавливайся)+$/i,
            
            // AJOUT: Expressions animales et sons créatifs
            /^(rawr|roar|growl|purr|meow|woof|bark)+$/i,
            /^(grr|grrr|rawrrr|raawwrr)+$/i,
            
            // AJOUT: Expressions de jeu de rôle
            /^(give it to me|donne-le moi|dámelo)+$/i,
            /^(take it|prends-le|tómalo)+$/i,
            /^(come here|viens ici|ven aquí)+$/i,
            /^(right there|juste là|ahí mismo)+$/i,
            
            // Expressions d'amour
            /i love you/i,
            /je t'aime/i,
            /te amo/i,
            /ti amo/i,
            /ich liebe dich/i,
            /я люблю тебя/i,
            
            // Compliments intimes
            /beautiful|gorgeous|sexy|hot|belle|hermosa|bella|schön|красивая/i,
            /amazing|incredible|fantastique|increíble|incredibile|невероятно/i,
            
            // AJOUT: Instructions et directions intimes
            /it's not moving/i,
            /keep going/i,
            /just like that/i,
            /right here/i,
            /hold on/i,
            /wait/i,
            /stop/i,
            /continue/i
        ];
        
        return emotionalPatterns.some(pattern => pattern.test(text.trim()));
    }

    /**
     * Sons intimes légitimes
     */
    isIntimateSound(text) {
        const intimateSounds = [
            /^(breathing|respiration|respiración|atmung|respirazione|дыхание)$/i,
            /^(heartbeat|battement|latido|herzschlag|battito|сердцебиение)$/i,
            /^(whisper|murmure|susurro|flüstern|sussurro|шепот)$/i,
            /^(sigh|soupir|suspiro|seufzer|sospiro|вздох)$/i,
            /^(gasp|halètement|jadeo|keuchen|ansimare|задыхание)$/i,
            /^(moan|gémissement|gemido|stöhnen|gemito|стон)$/i
        ];
        
        return intimateSounds.some(pattern => pattern.test(text.trim()));
    }

    /**
     * Segment trop long pour contexte adulte (plus permissif)
     */
    isSegmentTooLongForAdult(subtitle) {
        const duration = subtitle.end - subtitle.start;
        // Plus permissif pour contexte adulte (45s au lieu de 30s)
        return duration > 45;
    }

    /**
     * Nettoyage pour contenu conversationnel
     */
    cleanConversationalContent(text, subtitle, index, subtitles, expectedLanguage) {
        // Standards normaux pour conversations
        
        if (this.isShortWordRepetition(text)) {
            console.log(`🚫 Répétition conversation: "${text}"`);
            return false;
        }
        
        if (this.isConsecutiveRepetition(subtitles, index, 4)) {
            console.log(`🚫 Répétition consécutive: "${text}"`);
            return false;
        }
        
        if (this.isTechnicalHallucination(text)) {
            console.log(`🚫 Hallucination: "${text}"`);
            return false;
        }
        
        if (this.isSegmentTooLong(subtitle)) {
            console.log(`🚫 Segment trop long: ${subtitle.end - subtitle.start}s`);
            return false;
        }
        
        return true;
    }

    /**
     * Nettoyage pour contenu général
     */
    cleanGeneralContent(text, subtitle, index, subtitles, expectedLanguage) {
        // Nettoyage standard le plus strict
        
        if (this.isShortWordRepetition(text)) return false;
        if (this.isConsecutiveRepetition(subtitles, index, 3)) return false;
        if (this.isAudioHallucination(text)) return false;
        if (this.hasExcessiveCharacterRepetition(text)) return false;
        if (this.isWrongLanguage(text, expectedLanguage)) return false;
        if (this.isSegmentTooLong(subtitle)) return false;
        if (this.isNonsensicalText(text, expectedLanguage)) return false;
        
        return true;
    }

    /**
     * Améliorer la cohérence émotionnelle
     */
    improveEmotionalCoherence(subtitles, contentType) {
        if (contentType !== 'adult') {
            return subtitles;
        }
        
        console.log('💕 Amélioration de la cohérence émotionnelle...');
        
        // Fusionner les segments émotionnels courts et adjacents
        const improved = [];
        let currentSegment = null;
        
        for (const subtitle of subtitles) {
            if (!currentSegment) {
                currentSegment = { ...subtitle };
                continue;
            }
            
            // Vérifier si les segments doivent être fusionnés
            if (this.shouldMergeEmotionalSegments(currentSegment, subtitle)) {
                console.log(`💕 Fusion émotionnelle: "${currentSegment.text}" + "${subtitle.text}"`);
                currentSegment.end = subtitle.end;
                currentSegment.text = this.mergeEmotionalTexts(currentSegment.text, subtitle.text);
            } else {
                improved.push(currentSegment);
                currentSegment = { ...subtitle };
            }
        }
        
        if (currentSegment) {
            improved.push(currentSegment);
        }
        
        return improved;
    }

    /**
     * Fusionner segments émotionnels
     */
    shouldMergeEmotionalSegments(seg1, seg2) {
        const gap = seg2.start - seg1.end;
        
        // Fusionner si gap < 2 secondes et les deux sont des expressions émotionnelles courtes
        if (gap < 2 && 
            seg1.text.length < 20 && 
            seg2.text.length < 20 &&
            this.isLegitimateEmotionalExpression(seg1.text) &&
            this.isLegitimateEmotionalExpression(seg2.text)) {
            return true;
        }
        
        return false;
    }

    /**
     * Fusionner textes émotionnels
     */
    mergeEmotionalTexts(text1, text2) {
        // Si les textes sont identiques ou très similaires
        if (text1.toLowerCase().trim() === text2.toLowerCase().trim()) {
            return text1.trim();
        }
        
        // Si un texte est contenu dans l'autre
        if (text1.toLowerCase().includes(text2.toLowerCase())) return text1;
        if (text2.toLowerCase().includes(text1.toLowerCase())) return text2;
        
        // Fusionner avec ellipse pour le contexte émotionnel
        return `${text1.trim()}... ${text2.trim()}`;
    }

    // MÉTHODES DE DÉTECTION EXISTANTES (améliorées)

    isObviousRepetition(text) {
        const words = text.split(/\s+/);
        
        // Un seul mot répété plus de 5 fois
        if (words.length > 5) {
            const uniqueWords = [...new Set(words)];
            if (uniqueWords.length === 1) {
                return true;
            }
        }
        
        // Patterns évidents de répétition mécanique
        const obviousPatterns = [
            /^(.{1,10})\1{4,}$/,  // Même pattern répété 5+ fois
            /^(no|да|nein|non|não)\s*\1{4,}$/i,  // "No no no no no"
            /^(wait|attends|espera|warte)\s*\1{3,}$/i  // "Wait wait wait wait"
        ];
        
        return obviousPatterns.some(pattern => pattern.test(text));
    }

    isTechnicalHallucination(text) {
        const technicalPatterns = [
            /^\[.*\]$/,  // Texte entre crochets
            /^\(.*\)$/,  // Texte entre parenthèses
            /^.*♪.*$/,   // Symboles musicaux
            /^(music|música|musique|musik|музыка)$/i,
            /^(instrumental|background|fond sonore)$/i,
            /^(applause|applaudissements|aplausos)$/i,
            /^(silence|silencio|тишина)$/i
        ];
        
        return technicalPatterns.some(pattern => pattern.test(text.trim()));
    }

    // MÉTHODES EXISTANTES (conservées mais adaptées)

    isShortWordRepetition(text) {
        const words = text.split(/\s+/);
        
        if (words.length > 1) {
            const uniqueWords = [...new Set(words)];
            if (uniqueWords.length === 1 && words.length > 3) {
                return true;
            }
        }
        
        // Patterns spécifiques (plus permissifs pour contenu adulte)
        const restrictivePatterns = [
            /^(I can't\.?\s*){4,}$/i,
            /^(Держи,?\s*){4,}$/i,
            /^(Hold on,?\s*){4,}$/i
        ];
        
        return restrictivePatterns.some(pattern => pattern.test(text));
    }

    isConsecutiveRepetition(subtitles, currentIndex, threshold = 3) {
        const currentText = subtitles[currentIndex].text.trim().toLowerCase();
        let consecutiveCount = 1;
        
        // Compter vers l'arrière
        for (let i = currentIndex - 1; i >= 0; i--) {
            if (subtitles[i].text.trim().toLowerCase() === currentText) {
                consecutiveCount++;
            } else {
                break;
            }
        }
        
        // Compter vers l'avant
        for (let i = currentIndex + 1; i < subtitles.length; i++) {
            if (subtitles[i].text.trim().toLowerCase() === currentText) {
                consecutiveCount++;
            } else {
                break;
            }
        }
        
        return consecutiveCount >= threshold;
    }

    isAudioHallucination(text) {
        const audioPatterns = [
            /^(СТОНЫ|СТОН)$/i,
            /^(ТЯЖЕЛОЕ ДЫХАНИЕ|HEAVY BREATHING)$/i,
            /^(ЛИРИЧЕСКАЯ МЕЛОДИЯ|МУЗЫКА)$/i,
            /^(ДЫХАНИЕ|BREATHING)$/i,
            /^(MUSIC|МЕЛОДИЯ)$/i,
            /^(APPLAUSE|АПЛОДИСМЕНТЫ)$/i,
            /^(SILENCE|ТИШИНА)$/i
        ];
        
        return audioPatterns.some(pattern => pattern.test(text.trim()));
    }

    hasExcessiveCharacterRepetition(text) {
        // Répétitions de plus de 15 caractères identiques
        const repetitionPattern = /(.)\1{15,}/;
        if (repetitionPattern.test(text)) {
            return true;
        }
        
        // Répétitions de syllabes courtes
        const syllablePattern = /(.{1,3})\1{8,}/;
        return syllablePattern.test(text);
    }

    isWrongLanguage(text, expectedLanguage) {
        if (!expectedLanguage || expectedLanguage === 'auto') {
            return false;
        }
        
        const languagePatterns = {
            'en': /^[a-zA-Z\s\.,!?'"0-9\-:;]+$/,
            'fr': /^[a-zA-ZàâäéèêëïîôöùûüÿñçÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÑÇ\s\.,!?'"0-9\-:;]+$/,
            'es': /^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s\.,!?'"0-9\-:;]+$/,
            'de': /^[a-zA-ZäöüßÄÖÜ\s\.,!?'"0-9\-:;]+$/,
            'ru': /^[а-яё\s\.,!?'"0-9\-:;]+$/i
        };
        
        const pattern = languagePatterns[expectedLanguage];
        if (pattern && !pattern.test(text)) {
            return true;
        }
        
        return false;
    }

    isSegmentTooLong(subtitle) {
        const duration = subtitle.end - subtitle.start;
        const textLength = subtitle.text.length;
        
        // Segment de plus de 30 secondes
        if (duration > 30) {
            return true;
        }
        
        // Ratio texte/temps anormal
        if (textLength > 500 && duration < 5) {
            return true;
        }
        
        return false;
    }

    isNonsensicalText(text, expectedLanguage) {
        // Mots inventés typiques
        const nonsensicalPatterns = [
            /Ублэй\s+даймзу\s+хоумра/i,
            /подскалывай/i
        ];
        
        if (nonsensicalPatterns.some(pattern => pattern.test(text))) {
            return true;
        }
        
        // Mots trop longs
        const words = text.split(/\s+/);
        if (words.some(word => word.length > 25)) {
            return true;
        }
        
        // Ratio de consonnes excessives
        const consonantRatio = (text.match(/[bcdfghjklmnpqrstvwxzбвгджзклмнпрстфхцчшщ]/gi) || []).length / text.length;
        if (consonantRatio > 0.85) {
            return true;
        }
        
        return false;
    }

    /**
     * Transcription en chunks pour gros fichiers
     */
    async transcribeAudioInChunks(audioPath, sourceLanguage = 'auto') {
        const VideoProcessor = require('./VideoProcessor');
        const videoProcessor = new VideoProcessor();
        
        try {
            console.log('✂️ Division du fichier audio en segments...');
            
            // Segments plus courts pour meilleure précision
            const segments = await videoProcessor.splitAudioForProcessing(audioPath, 120);
            
            console.log(`📊 Fichier divisé en ${segments.length} segments`);
            
            let allSubtitles = [];
            let consecutiveFailures = 0;
            const maxConsecutiveFailures = 3;
            
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                console.log(`🎵 Transcription du segment ${i + 1}/${segments.length}...`);
                
                try {
                    const segmentSubtitles = await this.transcribeWithOpenAI(segment.path, sourceLanguage);
                    
                    if (segmentSubtitles.length === 0) {
                        console.log(`⚠️ Segment ${i + 1} vide, ajout d'un marqueur`);
                        allSubtitles.push({
                            index: allSubtitles.length + 1,
                            start: segment.startTime,
                            end: segment.startTime + segment.duration,
                            text: "[Segment audio sans parole détectable]"
                        });
                    } else {
                        // Ajuster les timestamps
                        const adjustedSubtitles = segmentSubtitles.map(subtitle => ({
                            ...subtitle,
                            index: allSubtitles.length + subtitle.index,
                            start: subtitle.start + segment.startTime,
                            end: subtitle.end + segment.startTime
                        }));
                        
                        allSubtitles = allSubtitles.concat(adjustedSubtitles);
                        consecutiveFailures = 0;
                    }
                    
                    console.log(`✅ Segment ${i + 1} transcrit: ${segmentSubtitles.length} sous-titres`);
                    
                } catch (error) {
                    console.error(`❌ Erreur segment ${i + 1}:`, error.message);
                    consecutiveFailures++;
                    
                    if (consecutiveFailures >= maxConsecutiveFailures) {
                        console.error(`💥 Trop d'échecs consécutifs (${consecutiveFailures}), arrêt du traitement`);
                        break;
                    }
                    
                    allSubtitles.push({
                        index: allSubtitles.length + 1,
                        start: segment.startTime,
                        end: segment.startTime + segment.duration,
                        text: `[Segment ${i + 1} - Transcription échouée: ${error.message}]`
                    });
                    
                } finally {
                    // Nettoyer le segment temporaire
                    try {
                        await fs.remove(segment.path);
                    } catch (cleanupError) {
                        console.error(`Erreur nettoyage segment ${i + 1}:`, cleanupError.message);
                    }
                }
            }
            
            // Finalisation
            const finalSubtitles = this.finalizeChunkedTranscription(allSubtitles);
            
            console.log(`🎉 Transcription par chunks terminée: ${finalSubtitles.length} segments au total`);
            return finalSubtitles;
            
        } catch (error) {
            console.error('❌ Erreur lors de la transcription par chunks:', error);
            throw error;
        }
    }

    finalizeChunkedTranscription(allSubtitles) {
        // Réindexer
        let indexedSubtitles = allSubtitles.map((subtitle, index) => ({
            ...subtitle,
            index: index + 1
        }));
        
        // Nettoyage final adaptatif
        indexedSubtitles = this.intelligentContentCleaning(indexedSubtitles, 'auto');
        
        // Validation finale
        const finalStats = this.validateSubtitleQuality(indexedSubtitles);
        
        return indexedSubtitles;
    }

    /**
     * Méthode alternative avec axios
     */
    async transcribeWithAxios(audioPath, sourceLanguage = 'auto') {
        console.log('🔄 Utilisation de la méthode alternative (axios)');
        
        try {
            const formData = new FormData();
            formData.append('file', fs.createReadStream(audioPath));
            formData.append('model', 'whisper-1');
            formData.append('response_format', 'verbose_json');
            formData.append('timestamp_granularities[]', 'segment');
            
            if (sourceLanguage !== 'auto') {
                formData.append('language', sourceLanguage);
                // NE PAS ajouter de prompt pour éviter contamination
            }

            const response = await axios.post(
                'https://api.openai.com/v1/audio/transcriptions',
                formData,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        ...formData.getHeaders()
                    },
                    timeout: 900000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                }
            );

            console.log('✅ Transcription axios réussie');
            return this.convertWhisperToSubtitles(response.data);

        } catch (error) {
            console.error('❌ Erreur avec axios:', error.message);
            throw error;
        }
    }

    /**
     * Méthode principale avec fallback
     */
    async transcribeAudio(audioPath, sourceLanguage = 'auto') {
        console.log(`🎵 Début de la transcription: ${path.basename(audioPath)}`);
        
        if (!await fs.pathExists(audioPath)) {
            throw new Error('Fichier audio non trouvé');
        }

        try {
            return await this.transcribeWithOpenAI(audioPath, sourceLanguage);
        } catch (error) {
            console.log(`⚠️ Méthode officielle échouée: ${error.message}`);
            
            if (this.isConnectionError(error)) {
                console.log('🔄 Basculement vers axios...');
                try {
                    return await this.transcribeWithAxios(audioPath, sourceLanguage);
                } catch (axiosError) {
                    console.error('❌ Axios a aussi échoué:', axiosError.message);
                }
            }
            
            throw error;
        }
    }

    /**
     * Traduction avec prise en compte du contexte adulte
     */
    async translateSubtitles(subtitles, targetLanguage = 'en') {
        const maxRetries = 3;
        
        // Analyser le contenu pour adapter la traduction
        const contentAnalysis = this.analyzeContentType(subtitles);
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🌐 Traduction ${contentAnalysis.type} vers ${targetLanguage} (tentative ${attempt}/${maxRetries})`);
                
                const chunks = this.chunkSubtitlesForTranslation(subtitles, 2000);
                let translatedSubtitles = [];
                
                for (let i = 0; i < chunks.length; i++) {
                    console.log(`📝 Traduction chunk ${i + 1}/${chunks.length}...`);
                    
                    const textToTranslate = chunks[i].map(sub => sub.text).join('\n');
                    
                    // Prompt de traduction adapté au contenu
                    const systemPrompt = this.getTranslationPrompt(targetLanguage, contentAnalysis.type);
                    
                    const response = await this.openai.chat.completions.create({
                        model: 'gpt-3.5-turbo',
                        messages: [
                            {
                                role: 'system',
                                content: systemPrompt
                            },
                            {
                                role: 'user',
                                content: textToTranslate
                            }
                        ],
                        temperature: contentAnalysis.type === 'adult' ? 0.2 : 0.3,
                        max_tokens: 4000
                    });

                    const translatedText = response.choices[0].message.content;
                    const translatedLines = translatedText.split('\n');

                    const chunkTranslated = chunks[i].map((subtitle, index) => ({
                        ...subtitle,
                        text: translatedLines[index] || subtitle.text
                    }));
                    
                    translatedSubtitles = translatedSubtitles.concat(chunkTranslated);
                    
                    if (i < chunks.length - 1) {
                        await this.sleep(1000);
                    }
                }

                console.log('✅ Traduction terminée');
                return translatedSubtitles;

            } catch (error) {
                console.error(`❌ Tentative traduction ${attempt} échouée:`, error.message);
                
                if (attempt < maxRetries && this.isRetryableError(error)) {
                    await this.sleep(attempt * 2000);
                    continue;
                }
                
                throw new Error(`Erreur de traduction: ${error.message}`);
            }
        }
    }

    /**
     * Prompts de traduction adaptés
     */
    getTranslationPrompt(targetLanguage, contentType) {
        const languageName = this.getLanguageName(targetLanguage);
        
        const basePrompt = `Tu es un traducteur professionnel spécialisé. Traduis le texte suivant vers ${languageName}. 
        Préserve la structure ligne par ligne. Chaque ligne doit être traduite sur une ligne séparée.`;
        
        if (contentType === 'adult') {
            return `${basePrompt}
            
            IMPORTANT: Ce contenu inclut des expressions intimes et émotionnelles. 
            - Préserve le ton émotionnel et l'intimité
            - Traduis les expressions d'amour et de passion naturellement
            - Garde les nuances émotionnelles et les murmures
            - Respecte le contexte adulte sans censure
            - Maintiens l'authenticité des expressions intimes`;
        } else if (contentType === 'conversation') {
            return `${basePrompt}
            
            Ce contenu est conversationnel. Traduis naturellement en préservant:
            - Le ton décontracté
            - Les expressions familières
            - Les interjections et hesitations`;
        } else {
            return `${basePrompt}
            
            Traduis précisément en maintenant le sens original.`;
        }
    }

    /**
     * Validation de qualité TRÈS PERMISSIVE
     */
    validateSubtitleQuality(subtitles) {
        const stats = {
            totalSegments: subtitles.length,
            totalDuration: 0,
            averageSegmentLength: 0,
            suspiciousSegments: 0,
            adultContentSegments: 0,
            emotionalSegments: 0
        };
        
        subtitles.forEach(subtitle => {
            const duration = subtitle.end - subtitle.start;
            stats.totalDuration += duration;
            
            // Compter SEULEMENT les segments VRAIMENT suspects (critères très relâchés)
            if (duration > 60 || subtitle.text.length === 0) { // Beaucoup plus permissif
                stats.suspiciousSegments++;
            }
            
            // Compter le contenu adulte/émotionnel
            if (this.isLegitimateEmotionalExpression(subtitle.text)) {
                stats.emotionalSegments++;
            }
            
            if (this.containsAdultContent(subtitle.text)) {
                stats.adultContentSegments++;
            }
        });
        
        stats.averageSegmentLength = stats.totalDuration / stats.totalSegments;
        
        console.log(`📊 Validation qualité PERMISSIVE:`);
        console.log(`   - Segments totaux: ${stats.totalSegments}`);
        console.log(`   - Durée moyenne: ${stats.averageSegmentLength.toFixed(1)}s`);
        console.log(`   - Segments VRAIMENT suspects: ${stats.suspiciousSegments} (${((stats.suspiciousSegments / stats.totalSegments) * 100).toFixed(1)}%)`);
        console.log(`   - Contenu émotionnel: ${stats.emotionalSegments} (${((stats.emotionalSegments / stats.totalSegments) * 100).toFixed(1)}%)`);
        console.log(`   - Contenu adulte: ${stats.adultContentSegments} (${((stats.adultContentSegments / stats.totalSegments) * 100).toFixed(1)}%)`);
        
        return stats;
    }

    /**
     * Détecter contenu adulte
     */
    containsAdultContent(text) {
        const adultIndicators = [
            /\b(love|aime|amor)\b/i,
            /\b(kiss|embrasse|beso)\b/i,
            /\b(touch|touche|toca)\b/i,
            /\b(beautiful|belle|hermosa)\b/i,
            /\b(sexy|hot|caliente)\b/i,
            /\b(baby|chéri|cariño)\b/i,
            /\b(pleasure|plaisir|placer)\b/i,
            /\b(desire|désir|deseo)\b/i
        ];
        
        return adultIndicators.some(pattern => pattern.test(text));
    }

    // MÉTHODES UTILITAIRES

    isRetryableError(error) {
        const retryableErrors = [
            'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED',
            'Connection error', 'timeout', 'socket hang up'
        ];
        
        return retryableErrors.some(errorType => 
            error.message.includes(errorType) || 
            error.code === errorType ||
            error.errno === errorType
        ) || error.status === 429 || error.status >= 500;
    }

    isConnectionError(error) {
        return this.isRetryableError(error) && !error.message.includes('quota');
    }

    calculateBackoffDelay(attempt) {
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 1000;
        return Math.min(baseDelay + jitter, 60000);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    chunkSubtitlesForTranslation(subtitles, maxChars = 2000) {
        const chunks = [];
        let currentChunk = [];
        let currentLength = 0;

        for (const subtitle of subtitles) {
            const textLength = subtitle.text.length;
            
            if (currentLength + textLength > maxChars && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [subtitle];
                currentLength = textLength;
            } else {
                currentChunk.push(subtitle);
                currentLength += textLength;
            }
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    convertWhisperToSubtitles(whisperResponse) {
        if (!whisperResponse.segments) {
            return [{
                index: 1,
                start: 0,
                end: 30,
                text: whisperResponse.text || "Transcription non disponible"
            }];
        }

        return whisperResponse.segments.map((segment, index) => ({
            index: index + 1,
            start: segment.start,
            end: segment.end,
            text: segment.text.trim()
        }));
    }

    formatAsSrt(subtitles) {
        return subtitles.map(subtitle => {
            const startTime = this.formatTimestamp(subtitle.start);
            const endTime = this.formatTimestamp(subtitle.end);
            
            return `${subtitle.index}\n${startTime} --> ${endTime}\n${subtitle.text}\n`;
        }).join('\n');
    }

    formatAsVtt(subtitles) {
        const vttContent = subtitles.map(subtitle => {
            const startTime = this.formatTimestamp(subtitle.start, 'vtt');
            const endTime = this.formatTimestamp(subtitle.end, 'vtt');
            
            return `${startTime} --> ${endTime}\n${subtitle.text}\n`;
        }).join('\n');
        
        return `WEBVTT\n\n${vttContent}`;
    }

    formatTimestamp(seconds, format = 'srt') {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        
        const separator = format === 'vtt' ? '.' : ',';
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}${separator}${ms.toString().padStart(3, '0')}`;
    }

    getLanguageName(langCode) {
        const languages = {
            'en': 'anglais',
            'fr': 'français',
            'es': 'espagnol',
            'de': 'allemand',
            'it': 'italien',
            'pt': 'portugais',
            'ru': 'russe',
            'zh': 'chinois',
            'ja': 'japonais',
            'ko': 'coréen',
            'ar': 'arabe'
        };
        
        return languages[langCode] || langCode;
    }

    async validateConfiguration() {
        try {
            if (!process.env.OPENAI_API_KEY) {
                throw new Error('Clé API OpenAI manquante');
            }
            
            for (let i = 0; i < 3; i++) {
                try {
                    await this.openai.models.list();
                    console.log('✅ Configuration OpenAI valide');
                    return true;
                } catch (error) {
                    if (i === 2) throw error;
                    await this.sleep(2000);
                }
            }
        } catch (error) {
            console.error('❌ Configuration OpenAI invalide:', error.message);
            return false;
        }
    }

    // MÉTHODES DE TEST ET DIAGNOSTIC

    async testAdultContentTranscription() {
        console.log('🧪 Test de transcription contenu adulte...');
        
        const testSubtitles = [
            { index: 1, start: 0, end: 2, text: "Oh baby, yes" },
            { index: 2, start: 2, end: 4, text: "I love you so much" },
            { index: 3, start: 4, end: 6, text: "Mmm, that feels amazing" },
            { index: 4, start: 6, end: 8, text: "You're so beautiful" },
            { index: 5, start: 8, end: 10, text: "Don't stop, please" },
            { index: 6, start: 10, end: 12, text: "I can't." }, // Répétition
            { index: 7, start: 12, end: 14, text: "I can't." }, // Répétition
            { index: 8, start: 14, end: 16, text: "More, honey" },
            { index: 9, start: 16, end: 18, text: "Je t'aime" },
            { index: 10, start: 18, end: 20, text: "МУЗЫКА" } // Hallucination
        ];
        
        const cleaned = this.intelligentContentCleaning(testSubtitles, 'en');
        
        console.log(`📊 Résultat test contenu adulte:`);
        console.log(`   - Segments originaux: ${testSubtitles.length}`);
        console.log(`   - Segments conservés: ${cleaned.length}`);
        console.log(`   - Taux de conservation: ${((cleaned.length / testSubtitles.length) * 100).toFixed(1)}%`);
        
        cleaned.forEach((sub, i) => {
            console.log(`   ✅ ${i + 1}: "${sub.text}"`);
        });
        
        return cleaned;
    }

    diagnoseThenClean(subtitles, expectedLanguage = 'auto') {
        console.log('🔍 Diagnostic complet avant nettoyage...');
        
        // Analyse du contenu
        const contentAnalysis = this.analyzeContentType(subtitles);
        console.log(`📋 Type de contenu: ${contentAnalysis.type} (${(contentAnalysis.confidence * 100).toFixed(1)}% confiance)`);
        
        // Statistiques détaillées
        const detailedStats = {
            total: subtitles.length,
            shortRepetitions: 0,
            technicalHallucinations: 0,
            audioHallucinations: 0,
            characterRepetitions: 0,
            wrongLanguage: 0,
            tooLong: 0,
            nonsensical: 0,
            adultContent: 0,
            emotionalExpressions: 0
        };
        
        subtitles.forEach(subtitle => {
            const text = subtitle.text.trim();
            
            if (this.isShortWordRepetition(text)) detailedStats.shortRepetitions++;
            if (this.isTechnicalHallucination(text)) detailedStats.technicalHallucinations++;
            if (this.isAudioHallucination(text)) detailedStats.audioHallucinations++;
            if (this.hasExcessiveCharacterRepetition(text)) detailedStats.characterRepetitions++;
            if (this.isWrongLanguage(text, expectedLanguage)) detailedStats.wrongLanguage++;
            if (this.isSegmentTooLong(subtitle)) detailedStats.tooLong++;
            if (this.isNonsensicalText(text, expectedLanguage)) detailedStats.nonsensical++;
            if (this.containsAdultContent(text)) detailedStats.adultContent++;
            if (this.isLegitimateEmotionalExpression(text)) detailedStats.emotionalExpressions++;
        });
        
        console.log('📊 Diagnostic détaillé:');
        Object.entries(detailedStats).forEach(([key, value]) => {
            if (key !== 'total') {
                const percentage = ((value / detailedStats.total) * 100).toFixed(1);
                console.log(`   - ${key}: ${value} (${percentage}%)`);
            }
        });
        
        // Nettoyage adaptatif
        const cleaned = this.intelligentContentCleaning(subtitles, expectedLanguage);
        
        console.log(`🧹 Résultat nettoyage:`);
        console.log(`   - Segments supprimés: ${subtitles.length - cleaned.length}`);
        console.log(`   - Taux de conservation: ${((cleaned.length / subtitles.length) * 100).toFixed(1)}%`);
        
        return cleaned;
    }
}

module.exports = SubtitleService;