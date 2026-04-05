const API_URL = import.meta.env.VITE_API_URL || 'https://google.test/api';

// Dynamically use PROD proxy URL when the Tauri app is built for release, otherwise use DEV proxy URL
export const PROXY_URL = import.meta.env.PROD
    ? (import.meta.env.VITE_PROXY_URL_PROD || 'https://google.devzoic.com')
    : (import.meta.env.VITE_PROXY_URL_DEV || 'https://google.test:4433');
class ApiService {
    constructor() {
        this.token = localStorage.getItem('auth_token') || null;
        this.baseUrl = API_URL;
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('auth_token', token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('auth_token');
    }

    getBaseUrl() {
        return this.baseUrl;
    }

    async request(method, endpoint, body = null, isFormData = false) {
        const headers = {};
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        if (!isFormData) headers['Content-Type'] = 'application/json';
        headers['Accept'] = 'application/json';

        const config = { method, headers };
        if (body) {
            config.body = isFormData ? body : JSON.stringify(body);
        }

        const res = await fetch(`${this.getBaseUrl()}${endpoint}`, config);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || `Request failed (${res.status})`);
        }
        return data;
    }

    // Auth
    login(email, password, hardwareId, deviceName, os) {
        return this.request('POST', '/auth/login', { email, password, hardware_id: hardwareId, device_name: deviceName, os });
    }

    register(name, email, password, hardwareId, deviceName, os) {
        return this.request('POST', '/auth/register', { name, email, password, hardware_id: hardwareId, device_name: deviceName, os });
    }

    // Accounts
    requestAccount(hardwareId) {
        return this.request('POST', '/accounts/request', { hardware_id: hardwareId });
    }

    switchAccount(currentAccountId, hardwareId) {
        return this.request('POST', '/accounts/switch', { current_account_id: currentAccountId, hardware_id: hardwareId });
    }

    activateProxyAccount(accountId, hardwareId) {
        return this.request('POST', '/accounts/activate-proxy', { account_id: accountId, hardware_id: hardwareId });
    }

    releaseAccount(accountId) {
        return this.request('POST', '/accounts/release', { account_id: accountId });
    }

    // Quota
    getCurrentQuota() {
        return this.request('GET', '/quota/current');
    }

    refreshQuota(accountId) {
        return this.request('POST', `/quota/refresh/${accountId}`);
    }


    reportUsage(accountId, requests, model = null) {
        return this.request('POST', '/usage/report', { account_id: accountId, requests, model });
    }

    // Device
    verifyDevice(hardwareId) {
        return this.request('POST', '/device/verify', { hardware_id: hardwareId });
    }

    // Session Guard — check if session is still valid
    sessionHeartbeat(hardwareId) {
        return this.request('POST', '/session/heartbeat', { hardware_id: hardwareId });
    }

    // Plans & Payments
    getPlans() {
        return this.request('GET', '/plans');
    }

    getPaymentMethods() {
        return this.request('GET', '/payment-methods');
    }

    submitPayment(planId, methodId, transactionId, proofFile) {
        const formData = new FormData();
        formData.append('plan_id', planId);
        formData.append('payment_method_id', methodId);
        if (transactionId) formData.append('transaction_id', transactionId);
        if (proofFile) formData.append('proof_file', proofFile);
        return this.request('POST', '/payments/submit', formData, true);
    }
}

export const api = new ApiService();
export default api;
