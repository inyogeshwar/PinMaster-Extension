class I18n {
    constructor() {
        this.messages = {}, this.currentLanguage = "en", this.supportedLanguages = {
            ar: "Arabic",
            de: "German",
            en: "English",
            es: "Spanish",
            fr: "French",
            hi: "Hindi",
            it: "Italian",
            ja: "Japanese",
            ko: "Korean",
            pt_BR: "Portuguese (Brazil)",
            ru: "Russian",
            zh_CN: "Chinese (China)"
        }, this.readyPromise = new Promise(e => {
            this._resolveReady = e
        })
    }
    async init() {
        const e = localStorage.getItem("pinterest_downloader_language");
        if (e && this.supportedLanguages[e]) this.currentLanguage = e;
        else {
            const e = navigator.language || navigator.userLanguage,
                a = e.split("-")[0];
            this.supportedLanguages[a] ? this.currentLanguage = a : "pt-BR" === e && this.supportedLanguages.pt_BR && (this.currentLanguage = "pt_BR")
        }
        await this.loadMessages(), this.translatePage(), this.setupLanguageSelector(), this._resolveReady && this._resolveReady(!0)
    }
    async loadMessages() {
        try {
            const e = await fetch(`_locales/${this.currentLanguage}/messages.json`);
            if (e.ok) this.messages = await e.json();
            else {
                const e = await fetch("_locales/en/messages.json");
                this.messages = await e.json()
            }
        } catch (e) {
            console.error("Error loading messages:", e);
            try {
                const e = await fetch("_locales/en/messages.json");
                this.messages = await e.json()
            } catch (e) {
                console.error("Error loading fallback messages:", e)
            }
        }
    }
    getMessage(e, a = {}) {
        const t = this.messages[e];
        if (!t) return console.warn(`Missing translation for key: ${e}`), e;
        let s = t.message;
        return Object.keys(a).forEach(e => {
            s = s.replace(new RegExp(`{${e}}`, "g"), a[e])
        }), s
    }
    translatePage() {
        document.querySelectorAll("[data-i18n]").forEach(e => {
            const a = e.getAttribute("data-i18n"),
                t = this.getMessage(a);
            "INPUT" === e.tagName && "button" === e.type ? e.value = t : "INPUT" === e.tagName && e.hasAttribute("placeholder") ? e.placeholder = t : e.textContent = t
        }), document.title = this.getMessage("appName")
    }
    async changeLanguage(e) {
        if (!this.supportedLanguages[e]) return void console.error(`Unsupported language: ${e}`);
        this.currentLanguage = e, localStorage.setItem("pinterest_downloader_language", e), await this.loadMessages(), this.translatePage();
        const a = document.getElementById("languageSelector");
        a && (a.value = e), window.dispatchEvent(new CustomEvent("languageChanged", {
            detail: {
                language: e,
                i18n: this
            }
        }))
    }
    setupLanguageSelector() {
        let e = document.getElementById("languageSelector");
        if (!e) {
            const a = document.getElementById("languageSelectorContainer");
            a && (e = document.createElement("select"), e.id = "languageSelector", e.className = "language-selector", Object.keys(this.supportedLanguages).forEach(a => {
                const t = document.createElement("option");
                t.value = a, t.textContent = this.supportedLanguages[a], e.appendChild(t)
            }), a.appendChild(e))
        }
        e && (e.value = this.currentLanguage, e.addEventListener("change", e => {
            this.changeLanguage(e.target.value)
        }))
    }
    updateDynamicText(e, a, t = {}) {
        const s = document.getElementById(e);
        s && (s.textContent = this.getMessage(a, t))
    }
}
