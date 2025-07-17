/**
 * Application de génération de sous-titres
 * Frontend JavaScript pour l'interface utilisateur - VERSION CORRIGÉE
 */

class SubtitleGenerator {
    constructor() {
        this.currentFile = null;
        this.currentJobId = null;
        this.currentSubtitles = null;
        this.progressSteps = ['step1', 'step2', 'step3', 'step4'];
        this.currentStep = 0;
        this.pollInterval = null;
        
        // CORRECTION: Variables pour contrôler les uploads
        this.uploadInProgress = false;
        this.lastUploadTime = 0;
        this.uploadTimeout = null;
        this.abortController = null;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.hideAllSections();
        console.log('🎬 Application de génération de sous-titres initialisée');
    }

    bindEvents() {
        // Drag & Drop avec protection
        const dropZone = document.getElementById('dropZone');
        if (dropZone) {
            dropZone.addEventListener('click', this.handleDropZoneClick.bind(this));
            dropZone.addEventListener('dragover', this.handleDragOver.bind(this));
            dropZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
            dropZone.addEventListener('drop', this.handleDrop.bind(this));
        }
        
        // Sélection de fichier avec protection
        const videoFile = document.getElementById('videoFile');
        if (videoFile) {
            videoFile.addEventListener('change', this.handleFileSelect.bind(this));
        }
        
        // Génération des sous-titres avec protection
        const generateBtn = document.getElementById('generateBtn');
        if (generateBtn) {
            generateBtn.addEventListener('click', this.handleGenerateClick.bind(this));
        }
        
        // Téléchargements
        const downloadSrt = document.getElementById('downloadSrt');
        const downloadVtt = document.getElementById('downloadVtt');
        if (downloadSrt) downloadSrt.addEventListener('click', () => this.downloadSubtitles('srt'));
        if (downloadVtt) downloadVtt.addEventListener('click', () => this.downloadSubtitles('vtt'));
        
        // Retry
        const retryBtn = document.getElementById('retryBtn');
        if (retryBtn) retryBtn.addEventListener('click', this.resetApplication.bind(this));
        
        // NOUVEAU: Gestionnaire de fermeture de page
        window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    }

    // CORRECTION: Gestion protégée du clic sur drop zone
    handleDropZoneClick() {
        if (this.uploadInProgress) {
            console.log('⚠️ Upload en cours, clic ignoré');
            this.showTemporaryMessage('Un upload est déjà en cours...');
            return;
        }
        
        const videoFile = document.getElementById('videoFile');
        if (videoFile) {
            videoFile.click();
        }
    }

    // CORRECTION: Gestion protégée du bouton générer
    handleGenerateClick(event) {
        event.preventDefault();
        event.stopPropagation();
        
        if (this.uploadInProgress) {
            console.log('⚠️ Upload déjà en cours, ignoré');
            this.showTemporaryMessage('Un upload est déjà en cours, veuillez patienter...');
            return;
        }
        
        // Vérifier le délai minimum entre uploads (5 secondes)
        const now = Date.now();
        if (now - this.lastUploadTime < 5000) {
            const remaining = Math.ceil((5000 - (now - this.lastUploadTime)) / 1000);
            this.showTemporaryMessage(`Attendez encore ${remaining} seconde(s) avant le prochain upload`);
            return;
        }
        
        this.generateSubtitles();
    }

    hideAllSections() {
        const sections = ['processingSection', 'progressSection', 'resultsSection', 'errorSection'];
        sections.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.style.display = 'none';
            }
        });
    }

    handleDragOver(e) {
        e.preventDefault();
        if (!this.uploadInProgress) {
            document.getElementById('dropZone').classList.add('dragover');
        }
    }

    handleDragLeave() {
        document.getElementById('dropZone').classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        document.getElementById('dropZone').classList.remove('dragover');
        
        if (this.uploadInProgress) {
            console.log('⚠️ Upload en cours, drop ignoré');
            this.showTemporaryMessage('Un upload est déjà en cours...');
            return;
        }
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.handleFile(files[0]);
        }
    }

    handleFileSelect(e) {
        if (this.uploadInProgress) {
            console.log('⚠️ Upload en cours, sélection ignorée');
            e.target.value = ''; // Reset l'input
            this.showTemporaryMessage('Un upload est déjà en cours...');
            return;
        }
        
        const file = e.target.files[0];
        if (file) {
            this.handleFile(file);
        }
    }

    handleFile(file) {
        console.log(`📁 Fichier sélectionné: ${file.name} (${this.formatFileSize(file.size)})`);
        
        // CORRECTION: Vérifications renforcées
        if (this.uploadInProgress) {
            this.showError('Un upload est déjà en cours, veuillez attendre...');
            return;
        }

        // Validation du fichier
        const validation = this.validateFile(file);
        if (!validation.isValid) {
            this.showError(validation.error);
            return;
        }

        // CORRECTION: Vérification taille réelle
        if (file.size === 0) {
            this.showError('Le fichier semble être vide (0 bytes). Veuillez vérifier le fichier.');
            return;
        }

        // CORRECTION: Vérification taille maximum raisonnable (10GB)
        if (file.size > 10 * 1024 * 1024 * 1024) {
            this.showError('Le fichier est trop volumineux (maximum 10GB). Veuillez utiliser un fichier plus petit.');
            return;
        }

        this.currentFile = file;
        this.setupVideoPreview(file);
        this.showFileDetails(file);
        
        // Afficher la section de traitement
        const processingSection = document.getElementById('processingSection');
        if (processingSection) {
            processingSection.style.display = 'block';
            processingSection.classList.add('slide-in');
        }
    }

    validateFile(file) {
        // Extensions supportées
        const allowedExtensions = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a'];
        const extension = file.name.split('.').pop().toLowerCase();
        
        if (!allowedExtensions.includes(extension)) {
            return {
                isValid: false,
                error: `Format non supporté. Formats acceptés: ${allowedExtensions.join(', ')}`
            };
        }

        // Vérification type MIME
        const allowedMimeTypes = [
            'video/mp4', 'video/avi', 'video/quicktime', 'video/x-msvideo',
            'video/x-matroska', 'video/webm', 'audio/mpeg', 'audio/wav',
            'audio/mp4', 'audio/x-m4a'
        ];

        if (file.type && !allowedMimeTypes.includes(file.type)) {
            console.log(`⚠️ Type MIME suspect: ${file.type}, mais extension OK`);
            // Ne pas bloquer, juste logger
        }

        return { isValid: true };
    }

    setupVideoPreview(file) {
        const video = document.getElementById('videoPreview');
        if (!video) return;
        
        // Nettoyer l'ancienne URL
        if (video.src) {
            URL.revokeObjectURL(video.src);
        }
        
        const url = URL.createObjectURL(file);
        video.src = url;
        
        // Afficher seulement si c'est une vidéo
        if (file.type.startsWith('video/')) {
            video.style.display = 'block';
        } else {
            video.style.display = 'none';
        }
    }

    showFileDetails(file) {
        const fileDetails = document.getElementById('fileDetails');
        if (!fileDetails) return;
        
        const fileSize = this.formatFileSize(file.size);
        const fileType = file.type || 'Type inconnu';
        
        fileDetails.innerHTML = `
            <strong>Fichier:</strong> ${file.name}<br>
            <strong>Taille:</strong> ${fileSize}<br>
            <strong>Type:</strong> ${fileType}
        `;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async generateSubtitles() {
        // CORRECTION: Verrous multiples de protection
        if (!this.currentFile) {
            this.showError('Aucun fichier sélectionné');
            return;
        }

        if (this.uploadInProgress) {
            console.log('⚠️ Upload déjà en cours');
            return;
        }

        try {
            // CORRECTION: Marquer l'upload comme en cours
            this.uploadInProgress = true;
            this.lastUploadTime = Date.now();
            
            console.log(`📤 Début upload: ${this.currentFile.name} (${this.formatFileSize(this.currentFile.size)})`);
            
            this.showProgressSection();
            this.disableGenerateButton();
            
            // CORRECTION: Créer AbortController pour pouvoir annuler
            this.abortController = new AbortController();
            
            // CORRECTION: FormData avec vérifications
            const formData = new FormData();
            formData.append('video', this.currentFile, this.currentFile.name);
            formData.append('sourceLanguage', document.getElementById('sourceLanguage')?.value || 'auto');
            formData.append('targetLanguage', document.getElementById('targetLanguage')?.value || 'en');

            // Simulation de progression
            this.updateProgress(0, 'Préparation de l\'upload...');
            this.setStepActive(0);

            // CORRECTION: Timeout de sécurité
            this.uploadTimeout = setTimeout(() => {
                if (this.abortController) {
                    console.log('⏰ Timeout upload, annulation...');
                    this.abortController.abort();
                    this.showError('Upload trop long, veuillez réessayer avec un fichier plus petit.');
                }
            }, 15 * 60 * 1000); // 15 minutes

            // CORRECTION: Fetch avec configuration robuste
            const response = await fetch('/api/subtitles/generate', {
                method: 'POST',
                body: formData,
                signal: this.abortController.signal,
                // IMPORTANT: Pas de headers Content-Type pour multipart
                keepalive: false
            });

            // Nettoyer le timeout
            if (this.uploadTimeout) {
                clearTimeout(this.uploadTimeout);
                this.uploadTimeout = null;
            }

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (e) {
                    errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
                }
                throw new Error(errorData.error || `Erreur serveur: ${response.status}`);
            }

            // Progression simulée pendant le traitement
            this.simulateProgress();

            const result = await response.json();

            if (result.success) {
                this.currentSubtitles = result.subtitles;
                this.currentJobId = result.jobId;
                this.showResults(result);
                console.log('✅ Upload et traitement réussis');
            } else {
                throw new Error(result.error || 'Erreur inconnue');
            }

        } catch (error) {
            console.error('❌ Erreur upload/traitement:', error);
            
            // Nettoyer le timeout
            if (this.uploadTimeout) {
                clearTimeout(this.uploadTimeout);
                this.uploadTimeout = null;
            }
            
            // Gestion des erreurs spécifiques
            if (error.name === 'AbortError') {
                this.showError('Upload annulé ou interrompu');
            } else if (error.message.includes('429')) {
                this.showError('Trop de requêtes. Attendez quelques secondes avant de réessayer.');
            } else if (error.message.includes('Failed to fetch')) {
                this.showError('Erreur de connexion. Vérifiez votre connexion internet.');
            } else {
                this.showError(error.message);
            }
        } finally {
            // CORRECTION: Toujours libérer les verrous
            this.uploadInProgress = false;
            this.abortController = null;
            this.enableGenerateButton();
            
            if (this.uploadTimeout) {
                clearTimeout(this.uploadTimeout);
                this.uploadTimeout = null;
            }
        }
    }

    showProgressSection() {
        this.hideAllSections();
        const progressSection = document.getElementById('progressSection');
        if (progressSection) {
            progressSection.style.display = 'block';
            progressSection.classList.add('slide-in');
        }
    }

    updateProgress(percentage, message) {
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
        if (progressText) {
            progressText.textContent = message;
        }
    }

    setStepActive(stepIndex) {
        this.progressSteps.forEach((stepId, index) => {
            const stepElement = document.getElementById(stepId);
            if (stepElement) {
                stepElement.classList.remove('active', 'completed');
                if (index < stepIndex) {
                    stepElement.classList.add('completed');
                } else if (index === stepIndex) {
                    stepElement.classList.add('active');
                }
            }
        });
    }

    simulateProgress() {
        let progress = 0;
        const messages = [
            'Extraction de l\'audio...',
            'Transcription en cours...',
            'Traduction...',
            'Finalisation...'
        ];

        const interval = setInterval(() => {
            if (!this.uploadInProgress) {
                clearInterval(interval);
                return;
            }
            
            progress += Math.random() * 15;
            if (progress > 95) progress = 95; // S'arrêter à 95% en attendant la réponse

            const stepIndex = Math.floor(progress / 25);
            if (stepIndex < messages.length) {
                this.updateProgress(progress, messages[stepIndex]);
                this.setStepActive(stepIndex);
            }
        }, 1000);

        // Nettoyer après 20 minutes maximum
        setTimeout(() => clearInterval(interval), 20 * 60 * 1000);
    }

    showResults(result) {
        this.hideAllSections();
        
        const resultsSection = document.getElementById('resultsSection');
        if (resultsSection) {
            resultsSection.style.display = 'block';
            resultsSection.classList.add('slide-in');
        }

        // Afficher les statistiques
        const subtitleStats = document.getElementById('subtitleStats');
        if (subtitleStats && result.metadata) {
            subtitleStats.innerHTML = `
                ${result.metadata.segmentCount || result.subtitles.length} segments • 
                ${this.formatDuration(result.metadata.duration)} • 
                ${result.metadata.sourceLanguage} → ${result.metadata.targetLanguage}
            `;
        }

        // Afficher l'aperçu des sous-titres
        this.displaySubtitles(result.subtitles);

        // Configurer les boutons de téléchargement
        this.setupDownloadButtons(result.downloads);
    }

    displaySubtitles(subtitles) {
        const subtitleDisplay = document.getElementById('subtitleDisplay');
        if (!subtitleDisplay) return;

        const srtContent = this.formatSubtitlesForDisplay(subtitles);
        subtitleDisplay.textContent = srtContent;
    }

    formatSubtitlesForDisplay(subtitles) {
        return subtitles.map((subtitle, index) => {
            const startTime = this.formatTimestamp(subtitle.start);
            const endTime = this.formatTimestamp(subtitle.end);
            return `${index + 1}\n${startTime} --> ${endTime}\n${subtitle.text}\n`;
        }).join('\n');
    }

    formatTimestamp(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    }

    formatDuration(seconds) {
        if (!seconds) return 'N/A';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    setupDownloadButtons(downloads) {
        const downloadSrt = document.getElementById('downloadSrt');
        const downloadVtt = document.getElementById('downloadVtt');

        if (downloads) {
            if (downloadSrt && downloads.srt) {
                downloadSrt.onclick = () => this.downloadFile(downloads.srt, 'srt');
            }
            if (downloadVtt && downloads.vtt) {
                downloadVtt.onclick = () => this.downloadFile(downloads.vtt, 'vtt');
            }
        }
    }

    downloadFile(url, format) {
        const link = document.createElement('a');
        link.href = url;
        link.download = `subtitles.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    downloadSubtitles(format) {
        if (!this.currentSubtitles || !this.currentJobId) {
            this.showError('Aucun sous-titre disponible pour le téléchargement');
            return;
        }

        const url = `/api/subtitles/download/${this.currentJobId}/${format}`;
        this.downloadFile(url, format);
    }

    showError(message) {
        this.hideAllSections();
        
        const errorSection = document.getElementById('errorSection');
        const errorMessage = document.getElementById('errorMessage');
        
        if (errorSection && errorMessage) {
            // Améliorer le message d'erreur pour l'utilisateur
            let userFriendlyMessage = message;
            
            if (message.includes('429') || message.includes('trop fréquent')) {
                userFriendlyMessage = `
                    ⏱️ Upload trop fréquent
                    
                    Vous uploadez trop rapidement. Attendez quelques secondes entre chaque tentative.
                    
                    Ceci évite la surcharge du serveur.
                `;
            } else if (message.includes('Quota OpenAI dépassé')) {
                userFriendlyMessage = `
                    ⚠️ Quota OpenAI dépassé
                    
                    Votre compte OpenAI a atteint sa limite d'utilisation.
                    
                    Solutions :
                    • Vérifiez votre usage sur platform.openai.com/usage
                    • Ajoutez du crédit sur platform.openai.com/account/billing
                    • Attendez le renouvellement de votre quota mensuel
                `;
            } else if (message.includes('Clé API OpenAI invalide')) {
                userFriendlyMessage = `
                    🔑 Clé API OpenAI invalide
                    
                    Vérifiez votre clé API sur platform.openai.com/api-keys
                `;
            } else if (message.includes('Failed to fetch') || message.includes('connexion')) {
                userFriendlyMessage = `
                    🌐 Problème de connexion
                    
                    Impossible de contacter le serveur.
                    • Vérifiez votre connexion internet
                    • Le serveur est peut-être temporairement indisponible
                    • Réessayez dans quelques minutes
                `;
            } else if (message.includes('trop volumineux') || message.includes('FILE_TOO_LARGE')) {
                userFriendlyMessage = `
                    📁 Fichier trop volumineux
                    
                    Le fichier dépasse la taille maximale autorisée.
                    • Compressez votre vidéo
                    • Ou utilisez un fichier plus court
                `;
            }
            
            errorMessage.textContent = userFriendlyMessage;
            errorSection.style.display = 'block';
            errorSection.classList.add('slide-in');
        }
        
        console.error('❌ Erreur:', message);
    }

    // NOUVEAU: Afficher un message temporaire
    showTemporaryMessage(message, duration = 3000) {
        // Créer ou réutiliser un élément de message temporaire
        let tempMessage = document.getElementById('tempMessage');
        if (!tempMessage) {
            tempMessage = document.createElement('div');
            tempMessage.id = 'tempMessage';
            tempMessage.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #ff9800;
                color: white;
                padding: 15px 20px;
                border-radius: 5px;
                z-index: 10000;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                font-weight: 500;
                max-width: 300px;
                word-wrap: break-word;
            `;
            document.body.appendChild(tempMessage);
        }
        
        tempMessage.textContent = message;
        tempMessage.style.display = 'block';
        
        // Masquer après la durée spécifiée
        setTimeout(() => {
            if (tempMessage) {
                tempMessage.style.display = 'none';
            }
        }, duration);
    }

    disableGenerateButton() {
        const btn = document.getElementById('generateBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<div class="loading-spinner"></div>Génération en cours...';
            btn.style.opacity = '0.6';
            btn.style.cursor = 'not-allowed';
        }
    }

    enableGenerateButton() {
        const btn = document.getElementById('generateBtn');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Générer les sous-titres';
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    }

    resetApplication() {
        console.log('🔄 Réinitialisation de l\'application...');
        
        // CORRECTION: Annuler tout upload en cours
        if (this.uploadInProgress && this.abortController) {
            console.log('🛑 Annulation de l\'upload en cours...');
            this.abortController.abort();
        }
        
        this.uploadInProgress = false;
        this.abortController = null;
        
        // Nettoyer les timeouts
        if (this.uploadTimeout) {
            clearTimeout(this.uploadTimeout);
            this.uploadTimeout = null;
        }
        
        // Réinitialiser les variables
        this.currentFile = null;
        this.currentJobId = null;
        this.currentSubtitles = null;
        this.currentStep = 0;

        // Nettoyer les intervalles
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        // Réinitialiser l'interface
        this.hideAllSections();
        
        // Réinitialiser le formulaire
        const videoFile = document.getElementById('videoFile');
        const videoPreview = document.getElementById('videoPreview');
        const fileDetails = document.getElementById('fileDetails');
        
        if (videoFile) videoFile.value = '';
        if (videoPreview) {
            // Libérer l'URL object si elle existe
            if (videoPreview.src) {
                URL.revokeObjectURL(videoPreview.src);
            }
            videoPreview.src = '';
            videoPreview.style.display = 'none';
        }
        if (fileDetails) fileDetails.innerHTML = '';

        // Réactiver le bouton
        this.enableGenerateButton();

        // Retour à l'état initial
        const dropZone = document.getElementById('dropZone');
        if (dropZone) {
            dropZone.classList.remove('dragover');
        }

        // Masquer le message temporaire
        const tempMessage = document.getElementById('tempMessage');
        if (tempMessage) {
            tempMessage.style.display = 'none';
        }

        console.log('✅ Application réinitialisée');
    }

    // NOUVEAU: Gestion de la fermeture de page
    handleBeforeUnload(event) {
        if (this.uploadInProgress) {
            event.preventDefault();
            event.returnValue = 'Un upload est en cours. Êtes-vous sûr de vouloir quitter ?';
            return event.returnValue;
        }
    }

    // Méthode utilitaire pour déboguer
    debug(message, data = null) {
        if (console && console.log) {
            console.log(`[SubtitleGenerator] ${message}`, data || '');
        }
    }

    // NOUVEAU: Méthode de diagnostic
    diagnose() {
        console.log('🔍 Diagnostic de l\'application:');
        console.log(`   - Upload en cours: ${this.uploadInProgress}`);
        console.log(`   - Fichier actuel: ${this.currentFile ? this.currentFile.name : 'aucun'}`);
        console.log(`   - Job ID: ${this.currentJobId || 'aucun'}`);
        console.log(`   - Sous-titres: ${this.currentSubtitles ? this.currentSubtitles.length + ' segments' : 'aucun'}`);
        console.log(`   - Dernier upload: ${this.lastUploadTime ? new Date(this.lastUploadTime).toLocaleTimeString() : 'jamais'}`);
        
        // Vérifier les éléments DOM
        const elements = [
            'dropZone', 'videoFile', 'generateBtn', 'processingSection', 
            'progressSection', 'resultsSection', 'errorSection'
        ];
        
        console.log('🔍 Éléments DOM:');
        elements.forEach(id => {
            const element = document.getElementById(id);
            console.log(`   - ${id}: ${element ? '✅' : '❌'}`);
        });
    }
}

// Fonction pour gérer les onglets d'aide (inchangée)
function showHelpTab(tabName) {
    // Cacher tous les panneaux
    const panels = document.querySelectorAll('.help-panel');
    panels.forEach(panel => panel.classList.remove('active'));
    
    // Désactiver tous les onglets
    const tabs = document.querySelectorAll('.help-tab');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Afficher le panneau sélectionné
    const selectedPanel = document.getElementById(`help-${tabName}`);
    if (selectedPanel) {
        selectedPanel.classList.add('active');
    }
    
    // Activer l'onglet sélectionné
    const selectedTab = event.target;
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
}

// CORRECTION: Initialisation plus robuste
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.subtitleGenerator = new SubtitleGenerator();
        console.log('✅ Application de génération de sous-titres initialisée avec succès');
        
        // NOUVEAU: Exposer la méthode de diagnostic globalement
        window.diagnoseApp = () => {
            if (window.subtitleGenerator) {
                window.subtitleGenerator.diagnose();
            } else {
                console.log('❌ Application non initialisée');
            }
        };
        
        // NOUVEAU: Commande de reset global
        window.resetApp = () => {
            if (window.subtitleGenerator) {
                window.subtitleGenerator.resetApplication();
                console.log('🔄 Application réinitialisée via commande globale');
            } else {
                console.log('❌ Application non initialisée');
            }
        };
        
    } catch (error) {
        console.error('💥 Erreur lors de l\'initialisation:', error);
        
        // Afficher une erreur à l'utilisateur
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #f44336;
            color: white;
            padding: 15px;
            text-align: center;
            z-index: 10000;
            font-weight: bold;
        `;
        errorDiv.textContent = 'Erreur lors de l\'initialisation de l\'application. Rechargez la page.';
        document.body.appendChild(errorDiv);
    }
});