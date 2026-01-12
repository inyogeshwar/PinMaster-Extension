var CONFIG = {
    GUMROAD: {
        // Base64 Encoded Product ID to avoid plain text scraping
        // Real ID: "AkHQgUKYqLnHhtR_hpxGdQ==" -> "QWtIUWdVS1lxTG5IaHRSX2hweEdkUQ=="
        PRODUCT_ID: 'YOUR_BASE64_PRODUCT_ID_HERE',
        VERIFY_ENDPOINT: 'https://api.gumroad.com/v2/licenses/verify'
    },
    LIMITS: {
        FREE_PIN_LIMIT: 50,
        REVERIFY_HOURS: 72
    },
    STORAGE_KEYS: {
        PRO_STATUS: 'pro_status',
        LICENSE_KEY: 'license_key',
        LAST_VERIFIED: 'last_verified_at'
    }
};
