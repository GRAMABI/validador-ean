/* ═══════════════════════════════════════ RESET & BASE */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --brand: #1a56db;
  --brand-dark: #1044b8;
  --green: #1D9E75;
  --green-bg: #e6f4ee;
  --red: #dc2626;
  --red-bg: #fee2e2;
  --amber: #d97706;
  --amber-bg: #fef3c7;
  --gray-bg: #f3f4f6;
  --gray-border: #e5e7eb;
  --gray-text: #6b7280;
  --text: #111827;
  --white: #ffffff;
  --topbar-h: 52px;
  --bottom-nav-h: 60px;
  --radius: 12px;
  --radius-sm: 8px;
}

html, body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--gray-bg);
  color: var(--text);
  overflow: hidden;
  font-size: 15px;
  -webkit-font-smoothing: antialiased;
}

/* ═══════════════════════════════════════ SCREENS */
.screen {
  display: none;
  position: fixed;
  inset: 0;
  flex-direction: column;
  background: var(--gray-bg);
  overflow: hidden;
}
.screen.active { display: flex; }

/* ═══════════════════════════════════════ TOPBAR */
.topbar {
  height: var(--topbar-h);
  background: var(--white);
  border-bottom: 1px solid var(--gray-border);
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 10px;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}
.topbar-title {
  flex: 1;
  font-weight: 600;
  font-size: 16px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.topbar-back {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--brand);
  cursor: pointer;
  padding: 6px 8px 6px 0;
  line-height: 1;
}
.topbar-action {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 6px;
}

/* ═══════════════════════════════════════ CONTENT */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
  padding-bottom: calc(var(--bottom-nav-h) + 16px);
  -webkit-overflow-scrolling: touch;
}
.content.no-top-pad { padding-top: 8px; }

/* ═══════════════════════════════════════ BOTTOM NAV */
.bottom-nav {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: var(--bottom-nav-h);
  background: var(--white);
  border-top: 1px solid var(--gray-border);
  display: flex;
  z-index: 10;
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 10px;
  color: var(--gray-text);
  cursor: pointer;
  transition: color .15s;
}
.nav-item span:first-child { font-size: 18px; }
.nav-item.active { color: var(--brand); }

/* ═══════════════════════════════════════ CARDS */
.card {
  background: var(--white);
  border: 1px solid var(--gray-border);
  border-radius: var(--radius);
  padding: 14px;
  margin-bottom: 10px;
}
.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--gray-border);
  gap: 8px;
}
.card-row:last-child { border-bottom: none; }
.card-label { font-size: 13px; color: var(--gray-text); flex-shrink: 0; }
.card-value { font-size: 13px; font-weight: 500; text-align: right; }
.text-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.mono { font-family: monospace; }

/* ═══════════════════════════════════════ SECTION LABELS */
.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--gray-text);
  text-transform: uppercase;
  letter-spacing: .6px;
  margin-bottom: 8px;
}

/* ═══════════════════════════════════════ BUTTONS */
.btn-primary {
  width: 100%;
  background: var(--brand);
  color: var(--white);
  border: none;
  border-radius: var(--radius-sm);
  padding: 14px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, opacity .15s;
}
.btn-primary:hover { background: var(--brand-dark); }
.btn-primary:disabled { opacity: .4; cursor: not-allowed; }

.btn-secondary {
  width: 100%;
  background: transparent;
  color: var(--text);
  border: 1px solid var(--gray-border);
  border-radius: var(--radius-sm);
  padding: 11px;
  font-size: 14px;
  cursor: pointer;
  transition: background .15s;
  display: block;
}
.btn-secondary:hover { background: var(--gray-bg); }

/* ═══════════════════════════════════════ BADGES */
.badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 20px;
  white-space: nowrap;
  flex-shrink: 0;
}
.badge-ok    { background: var(--green-bg); color: var(--green); }
.badge-error { background: var(--red-bg);   color: var(--red); }
.badge-warn  { background: var(--amber-bg); color: var(--amber); }
.badge-gray  { background: var(--gray-bg);  color: var(--gray-text); }

/* ═══════════════════════════════════════ ORDER LIST */
.order-item {
  background: var(--white);
  border: 1px solid var(--gray-border);
  border-radius: var(--radius);
  padding: 12px 14px;
  margin-bottom: 8px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  transition: background .1s;
  -webkit-tap-highlight-color: transparent;
}
.order-item:active { background: var(--gray-bg); }
.order-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
}
.dot-ok    { background: var(--green); }
.dot-error { background: var(--red); }
.dot-warn  { background: var(--amber); }
.order-info { flex: 1; min-width: 0; }
.order-name { font-weight: 600; font-size: 14px; }
.order-sub  { font-size: 12px; color: var(--gray-text); margin-top: 2px; }
.order-id-text { font-size: 10px; color: #aaa; font-family: monospace; margin-top: 2px; }

/* ═══════════════════════════════════════ PROGRESS */
.progress-bar-wrap {
  height: 4px;
  background: var(--gray-border);
  flex-shrink: 0;
}
.progress-bar-fill {
  height: 100%;
  background: var(--green);
  transition: width .4s ease;
  width: 0%;
}
.progress-label {
  font-size: 11px;
  color: var(--gray-text);
  padding: 5px 14px 0;
  flex-shrink: 0;
}

/* ═══════════════════════════════════════ ORDER DETAIL */
.order-id-bar {
  font-size: 11px;
  font-family: monospace;
  color: #aaa;
  padding: 4px 14px;
  background: var(--white);
  border-bottom: 1px solid var(--gray-border);
  flex-shrink: 0;
}

.sku-item {
  background: var(--white);
  border: 1px solid var(--gray-border);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.sku-check {
  width: 26px; height: 26px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  flex-shrink: 0;
}
.check-ok    { background: var(--green-bg); color: var(--green); }
.check-error { background: var(--red-bg);   color: var(--red); }
.check-warn  { background: var(--amber-bg); color: var(--amber); }
.check-gray  { background: var(--gray-bg);  color: var(--gray-text); }

.sku-info { flex: 1; min-width: 0; }
.sku-code { font-size: 12px; font-weight: 600; font-family: monospace; }
.sku-name { font-size: 11px; color: var(--gray-text); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sku-ean  { font-size: 10px; color: #bbb; font-family: monospace; margin-top: 1px; }
.sku-qty  { font-size: 12px; color: var(--gray-text); flex-shrink: 0; }

/* ═══════════════════════════════════════ SCANNER */
.scanner-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4/3;
  background: #000;
  border-radius: var(--radius);
  overflow: hidden;
  margin: 8px 0;
}
#scanner-video, #scanner-video-free {
  width: 100%; height: 100%;
  object-fit: cover;
}
.scanner-overlay-frame {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.scanner-overlay-frame::before {
  content: '';
  position: absolute;
  width: 70%; height: 45%;
  border: 2px solid rgba(255,255,255,.7);
  border-radius: 6px;
}
.scanner-line {
  position: absolute;
  width: 65%;
  height: 2px;
  background: linear-gradient(90deg, transparent, #1D9E75, transparent);
  animation: scan 2s ease-in-out infinite;
}
@keyframes scan {
  0%   { top: 30%; }
  50%  { top: 67%; }
  100% { top: 30%; }
}
.scanner-hint {
  position: absolute;
  bottom: 10px;
  width: 100%;
  text-align: center;
  font-size: 12px;
  color: rgba(255,255,255,.7);
}
.scanner-controls {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

/* ═══════════════════════════════════════ BOTTOM ACTION */
.bottom-action {
  padding: 10px 14px;
  background: var(--white);
  border-top: 1px solid var(--gray-border);
  flex-shrink: 0;
}

/* ═══════════════════════════════════════ TOAST */
#toast-container {
  position: fixed;
  bottom: 80px;
  left: 14px; right: 14px;
  z-index: 100;
  pointer-events: none;
}
.toast {
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  margin-top: 6px;
  animation: slideup .2s ease;
}
.toast-ok    { background: var(--green-bg); color: var(--green); border: 1px solid #86efac; }
.toast-error { background: var(--red-bg);   color: var(--red);   border: 1px solid #fca5a5; }
.toast-warn  { background: var(--amber-bg); color: var(--amber); border: 1px solid #fcd34d; }
@keyframes slideup {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
}

/* ═══════════════════════════════════════ SUMMARY */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.metric-card {
  background: var(--white);
  border: 1px solid var(--gray-border);
  border-radius: var(--radius-sm);
  padding: 12px 8px;
  text-align: center;
}
.metric-val { font-size: 26px; font-weight: 700; }
.metric-val.green  { color: var(--green); }
.metric-val.red    { color: var(--red); }
.metric-val.amber  { color: var(--amber); }
.metric-label { font-size: 11px; color: var(--gray-text); margin-top: 2px; }

.summary-item {
  background: var(--white);
  border: 1px solid var(--gray-border);
  border-radius: var(--radius);
  padding: 10px 14px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.summary-name { font-size: 13px; font-weight: 500; }
.summary-sub  { font-size: 11px; color: var(--gray-text); }

/* ═══════════════════════════════════════ LOGIN */
.login-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  gap: 8px;
}
.login-icon  { font-size: 64px; margin-bottom: 8px; }
.login-title { font-size: 28px; font-weight: 700; color: var(--brand); }
.login-sub   { font-size: 15px; color: var(--gray-text); margin-bottom: 16px; }
.login-card  {
  background: var(--white);
  border: 1px solid var(--gray-border);
  border-radius: var(--radius);
  padding: 20px;
  width: 100%;
  max-width: 340px;
}
.login-desc { font-size: 14px; color: var(--gray-text); margin-bottom: 16px; line-height: 1.5; }

/* ═══════════════════════════════════════ LOADER */
#loader {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}
.loader-box {
  background: var(--white);
  border-radius: var(--radius);
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-width: 180px;
}
.spinner {
  width: 36px; height: 36px;
  border: 3px solid var(--gray-border);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loader-msg { font-size: 14px; color: var(--gray-text); text-align: center; }

/* ═══════════════════════════════════════ MISC */
.error-msg {
  background: var(--red-bg);
  color: var(--red);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 13px;
  margin-top: 8px;
}
.hint-text { font-size: 13px; color: var(--gray-text); margin-bottom: 10px; }
.mt-8  { margin-top: 8px !important; }
.mt-16 { margin-top: 16px !important; }
.mt-24 { margin-top: 24px !important; }
