import { useState, useEffect, useMemo } from "react";

const SUPABASE_URL = "https://cvmsblijgvlngvgrdohd.supabase.co";
const SUPABASE_KEY = "sb_publishable_ut3pcuiUtqwtAnXfTL-ZGQ_7uzg0SOe";
const STRIPE_PK    = "pk_live_51ThY3i0X1xqp06zjJEJWkvtRVTMJ9sKUkf7LvLsesmenbNCHJeOcW0Sp5DqmwdLj2vk5ML4s3VtQG7PHTr2K17H300FdLaSQo3";
const STRIPE_PRICE = "price_1TmFFa0X1xqp06zjHCVpX2bn";
const APP_NAME     = "GestiónObras";
const PRECIO_MES   = 24.99;

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAY_LABELS = ["L","M","X","J","V","S","D"];
const PUESTO_COLORS = ["#2563EB","#7C3AED","#D97706","#059669","#DC2626","#0891B2","#9333EA","#0D9488"];
const fmt = (n) => Number(n).toFixed(2) + "€";

// ── Supabase client ────────────────────────────────────────────────────────
const sb = {
  h: (token) => ({
    "Content-Type": "application/json",
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${token || SUPABASE_KEY}`
  }),
  async query(table, query, token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query||""}`, { headers: this.h(token) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async insert(table, data, token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST", headers: { ...this.h(token), "Prefer": "return=representation" },
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(await r.text());
    const res = await r.json();
    return Array.isArray(res) ? res[0] : res;
  },
  async update(table, id, data, token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH", headers: { ...this.h(token), "Prefer": "return=representation" },
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(await r.text());
    const res = await r.json();
    return Array.isArray(res) ? res[0] : res;
  },
  async delete(table, id, token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE", headers: this.h(token)
    });
    if (!r.ok) throw new Error(await r.text());
    return true;
  },
  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || "Email o contraseña incorrectos");
    return d;
  },
  async signUp(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || "Error al registrarse");
    return d;
  },
  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
  }
};

const LS = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};

// ── Trial helpers ──────────────────────────────────────────────────────────
function getDaysLeft(createdAt) {
  const created = new Date(createdAt);
  const now = new Date();
  const diff = Math.ceil((created.getTime() + 14 * 86400000 - now.getTime()) / 86400000);
  return diff;
}

function getTrialStatus(empresa) {
  if (!empresa) return "unknown";
  if (empresa.plan === "activo") return "activo";
  const days = getDaysLeft(empresa.created_at);
  if (days > 3) return "trial_ok";
  if (days > 0) return "trial_warning";
  return "expired";
}

// ── Stripe checkout ────────────────────────────────────────────────────────
const STRIPE_LINK = "https://buy.stripe.com/3cI00beJrf93ed4ea3c3m00";

async function redirectToCheckout(empresaId, email) {
  // Open Stripe Payment Link with empresa info as metadata
  const url = `${STRIPE_LINK}?prefilled_email=${encodeURIComponent(email)}&client_reference_id=${empresaId}`;
  window.location.href = url;
}

// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [session,  setSession]  = useState(() => LS.get("go_session"));
  const [empresa,  setEmpresa]  = useState(null);
  const [authView, setAuthView] = useState("login");
  const [loading,  setLoading]  = useState(false);
  const [initDone, setInitDone] = useState(false);

  // Check URL params for payment success
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("pago") === "ok") {
      const empresaId = params.get("empresa");
      if (empresaId) {
        fetch(`${SUPABASE_URL}/rest/v1/empresas?id=eq.${empresaId}`, {
          method: "PATCH",
          headers: { ...sb.h(SUPABASE_KEY), "Prefer": "return=representation" },
          body: JSON.stringify({ plan: "activo" })
        });
      }
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    if (session) {
      loadEmpresa(session).finally(() => setInitDone(true));
    } else {
      setInitDone(true);
    }
  }, []);

  const loadEmpresa = async (sess) => {
    try {
      const perfiles = await sb.query("perfiles", `?id=eq.${sess.user.id}&select=*,empresas(*)`, sess.access_token);
      if (perfiles.length > 0 && perfiles[0].empresas) {
        setEmpresa(perfiles[0].empresas);
        setSession(sess);
        LS.set("go_session", sess);
      }
    } catch {
      LS.del("go_session");
      setSession(null);
    }
  };

  const handleLogin = async (email, password) => {
    setLoading(true);
    try {
      const data = await sb.signIn(email, password);
      await loadEmpresa(data);
    } finally { setLoading(false); }
  };

  const handleRegister = async (email, password, nombre, nombreEmpresa) => {
    setLoading(true);
    try {
      const data = await sb.signUp(email, password);
      if (data.user) {
        const emp = await fetch(`${SUPABASE_URL}/rest/v1/empresas`, {
          method: "POST",
          headers: { ...sb.h(SUPABASE_KEY), "Prefer": "return=representation" },
          body: JSON.stringify({ nombre: nombreEmpresa, email })
        }).then(r => r.json());
        const empresaId = Array.isArray(emp) ? emp[0]?.id : emp?.id;
        if (!empresaId) throw new Error("No se pudo crear la empresa");
        await fetch(`${SUPABASE_URL}/rest/v1/perfiles`, {
          method: "POST",
          headers: { ...sb.h(SUPABASE_KEY), "Prefer": "return=representation" },
          body: JSON.stringify({ id: data.user.id, empresa_id: empresaId, nombre })
        });
        const puestosDefault = [
          { empresa_id: empresaId, nombre: "Oficial de 1ª", peonada: 110 },
          { empresa_id: empresaId, nombre: "Oficial de 2ª", peonada: 95 },
          { empresa_id: empresaId, nombre: "Capataz", peonada: 130 },
          { empresa_id: empresaId, nombre: "Peón", peonada: 80 },
          { empresa_id: empresaId, nombre: "Conductor", peonada: 120 },
          { empresa_id: empresaId, nombre: "Encargado", peonada: 150 },
        ];
        await fetch(`${SUPABASE_URL}/rest/v1/puestos`, {
          method: "POST",
          headers: sb.h(SUPABASE_KEY),
          body: JSON.stringify(puestosDefault)
        });
        await handleLogin(email, password);
      }
    } finally { setLoading(false); }
  };

  const handleLogout = async () => {
    if (session) await sb.signOut(session.access_token).catch(() => {});
    LS.del("go_session");
    setSession(null);
    setEmpresa(null);
  };

  const handlePagar = () => redirectToCheckout(empresa.id, empresa.email);

  const handleRefrescarPlan = async () => {
    if (session) await loadEmpresa(session);
  };

  if (!initDone) return <Splash />;

  if (!session || !empresa) {
    return <AuthScreen view={authView} setView={setAuthView} onLogin={handleLogin} onRegister={handleRegister} loading={loading} />;
  }

  const trialStatus = getTrialStatus(empresa);
  const daysLeft    = getDaysLeft(empresa.created_at);

  // ── EXPIRED — mostrar pantalla de pago ──
  if (trialStatus === "expired") {
    return <ExpiredScreen empresa={empresa} onPagar={handlePagar} onLogout={handleLogout} onRefrescar={handleRefrescarPlan} />;
  }

  return (
    <MainApp
      session={session} empresa={empresa}
      trialStatus={trialStatus} daysLeft={daysLeft}
      onLogout={handleLogout} onPagar={handlePagar}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPIRED SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function ExpiredScreen({ empresa, onPagar, onLogout, onRefrescar }) {
  const [paying, setPaying] = useState(false);
  const handlePagar = async () => {
    setPaying(true);
    try { await onPagar(); } catch { setPaying(false); }
  };
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0F2444,#1B3E6E)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: 40, maxWidth: 440, width: "100%", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>⏰</div>
        <h2 style={{ fontWeight: 800, fontSize: 24, color: "#0F2444", marginBottom: 10 }}>Tu prueba gratuita ha terminado</h2>
        <p style={{ color: "#64748b", fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
          Para seguir usando {APP_NAME} activa tu suscripción por solo <strong style={{ color: "#0F2444" }}>{PRECIO_MES}€/mes</strong>.
        </p>
        <div style={{ background: "#F8FAFC", borderRadius: 14, padding: "16px 20px", marginBottom: 24, textAlign: "left" }}>
          {["Trabajadores y peonadas ilimitados", "Control de anticipos y obras", "Facturas profesionales en PDF", "Datos guardados en la nube", "Acceso desde cualquier dispositivo"].map(f => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13, color: "#475569" }}>
              <span style={{ color: "#10B981", fontWeight: 800 }}>✓</span> {f}
            </div>
          ))}
        </div>
        <button onClick={handlePagar} disabled={paying} style={{ width: "100%", background: "#F59E0B", color: "#0F2444", border: "none", borderRadius: 12, padding: "15px", fontWeight: 800, fontSize: 16, cursor: paying ? "not-allowed" : "pointer", marginBottom: 10 }}>
          {paying ? "Redirigiendo a pago..." : `Activar por ${PRECIO_MES}€/mes →`}
        </button>
        <button onClick={onRefrescar} style={{ width: "100%", background: "#EFF6FF", color: "#0F2444", border: "none", borderRadius: 12, padding: "12px", fontWeight: 600, fontSize: 14, cursor: "pointer", marginBottom: 10 }}>
          Ya he pagado — actualizar
        </button>
        <button onClick={onLogout} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 13, cursor: "pointer" }}>Cerrar sesión</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function AuthScreen({ view, setView, onLogin, onRegister, loading }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre]     = useState("");
  const [empresa, setEmpresa]   = useState("");
  const [error, setError]       = useState("");

  const handleSubmit = async () => {
    setError("");
    if (!email || !password) { setError("Rellena todos los campos"); return; }
    try {
      if (view === "login") {
        await onLogin(email, password);
      } else {
        if (!nombre || !empresa) { setError("Rellena todos los campos"); return; }
        await onRegister(email, password, nombre, empresa);
      }
    } catch (e) { setError(e.message); }
  };

  const inp = { width: "100%", border: "1px solid #E2E8F0", borderRadius: 10, padding: "11px 14px", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10, fontFamily: "inherit", color: "#1e293b" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0F2444,#1B3E6E)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🏗️</div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 28 }}>{APP_NAME}</div>
          <div style={{ color: "rgba(255,255,255,.6)", fontSize: 14, marginTop: 4 }}>Software de gestión para construcción</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 20, padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
          <div style={{ display: "flex", marginBottom: 24, background: "#F1F5F9", borderRadius: 10, padding: 3 }}>
            {[["login", "Iniciar sesión"], ["register", "Crear cuenta"]].map(([v, l]) => (
              <button key={v} onClick={() => { setView(v); setError(""); }} style={{ flex: 1, border: "none", borderRadius: 8, padding: "9px", cursor: "pointer", fontWeight: 600, fontSize: 13, background: view === v ? "#fff" : "transparent", color: view === v ? "#0F2444" : "#64748b", boxShadow: view === v ? "0 1px 4px rgba(0,0,0,.1)" : "none" }}>
                {l}
              </button>
            ))}
          </div>
          {view === "register" && <>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" style={inp} />
            <input value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Nombre de tu empresa" style={inp} />
          </>}
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={inp} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Contraseña" style={{ ...inp, marginBottom: 0 }} onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 8, padding: "8px 10px", background: "#fff5f5", borderRadius: 7 }}>{error}</div>}
          <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", marginTop: 16, background: loading ? "#94a3b8" : "#0F2444", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Cargando..." : view === "login" ? "Entrar" : "Crear cuenta gratis"}
          </button>
          {view === "register" && (
            <div style={{ marginTop: 14, fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.5 }}>
              14 días de prueba gratuita · Luego {PRECIO_MES}€/mes<br />Sin permanencia · Cancela cuando quieras
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIAL BANNER
// ═══════════════════════════════════════════════════════════════════════════
function TrialBanner({ daysLeft, trialStatus, onPagar }) {
  if (trialStatus === "activo") return null;
  const isWarning = trialStatus === "trial_warning";
  return (
    <div style={{ background: isWarning ? "#FEF3C7" : "#EFF6FF", borderBottom: `2px solid ${isWarning ? "#F59E0B" : "#3B82F6"}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <div style={{ fontSize: 13, color: isWarning ? "#92400E" : "#1D4ED8", fontWeight: 600 }}>
        {isWarning ? `⚠️ Tu prueba gratuita termina en ${daysLeft} día${daysLeft !== 1 ? "s" : ""}` : `🎉 Prueba gratuita — ${daysLeft} días restantes`}
      </div>
      <button onClick={onPagar} style={{ background: isWarning ? "#F59E0B" : "#0F2444", color: isWarning ? "#0F2444" : "#fff", border: "none", borderRadius: 20, padding: "6px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
        Activar ahora — {PRECIO_MES}€/mes
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
function MainApp({ session, empresa, trialStatus, daysLeft, onLogout, onPagar }) {
  const token = session.access_token;
  const eId   = empresa.id;

  const [tab,        setTab]        = useState("asistencia");
  const [data,       setData]       = useState({ obras: [], puestos: [], trabajadores: [], peonadas: [], anticipos: [], clientes: [], facturas: [] });
  const [loading,    setLoading]    = useState(true);
  const [toast,      setToast]      = useState(null);
  const [selMonth,   setSelMonth]   = useState(new Date().getMonth());
  const [selYear,    setSelYear]    = useState(new Date().getFullYear());
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [wModal,     setWModal]     = useState(null);
  const [pModal,     setPModal]     = useState(null);
  const [oModal,     setOModal]     = useState(null);
  const [aModal,     setAModal]     = useState(null);
  const [fModal,     setFModal]     = useState(null);
  const [fView,      setFView]      = useState(null);

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800); };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [obras, puestos, trabajadores, peonadas, anticipos, clientes, facturas] = await Promise.all([
        sb.query("obras",        `?empresa_id=eq.${eId}&order=created_at`, token),
        sb.query("puestos",      `?empresa_id=eq.${eId}&order=created_at`, token),
        sb.query("trabajadores", `?empresa_id=eq.${eId}&activo=eq.true&order=created_at`, token),
        sb.query("peonadas",     `?empresa_id=eq.${eId}`, token),
        sb.query("anticipos",    `?empresa_id=eq.${eId}`, token),
        sb.query("clientes",     `?empresa_id=eq.${eId}&order=nombre`, token),
        sb.query("facturas",     `?empresa_id=eq.${eId}&order=created_at.desc`, token),
      ]);
      setData({ obras, puestos, trabajadores, peonadas, anticipos, clientes, facturas });
    } catch { showToast("Error cargando datos", "err"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const monthDays = useMemo(() => getDaysInMonth(selYear, selMonth), [selYear, selMonth]);

  const mkFecha     = (d) => `${selYear}-${String(selMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const isDayWorked = (wId, d) => data.peonadas.some(p => p.trabajador_id === wId && p.fecha === mkFecha(d));

  const toggleDay = async (wId, d) => {
    const fecha    = mkFecha(d);
    const existing = data.peonadas.find(p => p.trabajador_id === wId && p.fecha === fecha);
    try {
      if (existing) {
        await sb.delete("peonadas", existing.id, token);
        setData(prev => ({ ...prev, peonadas: prev.peonadas.filter(p => p.id !== existing.id) }));
      } else {
        const nueva = await sb.insert("peonadas", { empresa_id: eId, trabajador_id: wId, fecha }, token);
        setData(prev => ({ ...prev, peonadas: [...prev.peonadas, nueva] }));
      }
    } catch { showToast("Error al guardar", "err"); }
  };

  const calcWorker = (w) => {
    const puesto   = data.puestos.find(p => p.id === w.puesto_id);
    const diasTrab = monthDays.filter(({ d }) => isDayWorked(w.id, d)).length;
    const bruto    = puesto ? diasTrab * puesto.peonada : 0;
    const antList  = data.anticipos.filter(a => {
      const f = new Date(a.fecha);
      return a.trabajador_id === w.id && f.getMonth() === selMonth && f.getFullYear() === selYear;
    });
    const antic = antList.reduce((s, a) => s + a.importe, 0);
    return { diasTrab, bruto, antic, pendiente: bruto - antic, puesto, antList };
  };

  const totales = data.trabajadores.reduce((acc, w) => {
    const c = calcWorker(w);
    return { dias: acc.dias + c.diasTrab, bruto: acc.bruto + c.bruto, antic: acc.antic + c.antic, pend: acc.pend + c.pendiente };
  }, { dias: 0, bruto: 0, antic: 0, pend: 0 });

  const obraStats = data.obras.map(o => {
    const ws = data.trabajadores.filter(w => w.obra_id === o.id);
    return { ...o, peonadas: ws.reduce((s, w) => s + calcWorker(w).diasTrab, 0), coste: ws.reduce((s, w) => s + calcWorker(w).bruto, 0), numW: ws.length, wList: ws };
  });

  const calcFacturaTotals = (f) => {
    const lineas  = Array.isArray(f.lineas) ? f.lineas : [];
    const base    = lineas.reduce((s, l) => s + (parseFloat(l.cantidad) || 0) * (parseFloat(l.precio) || 0), 0);
    const ivaAmt  = base * (f.iva || 21) / 100;
    return { base, ivaAmt, total: base + ivaAmt };
  };

  const saveWorker = async (form, editId) => {
    try {
      const payload = { empresa_id: eId, nombre: form.nombre, puesto_id: form.puesto_id || null, obra_id: form.obra_id || null };
      if (editId) {
        const upd = await sb.update("trabajadores", editId, payload, token);
        setData(prev => ({ ...prev, trabajadores: prev.trabajadores.map(w => w.id === editId ? upd : w) }));
        showToast("Trabajador actualizado ✓");
      } else {
        const nuevo = await sb.insert("trabajadores", payload, token);
        setData(prev => ({ ...prev, trabajadores: [...prev.trabajadores, nuevo] }));
        showToast("Trabajador añadido ✓");
      }
      setWModal(null);
    } catch { showToast("Error al guardar", "err"); }
  };

  const savePuesto = async (form, editId) => {
    try {
      const payload = { empresa_id: eId, nombre: form.nombre, peonada: parseFloat(form.peonada) };
      if (editId) {
        const upd = await sb.update("puestos", editId, payload, token);
        setData(prev => ({ ...prev, puestos: prev.puestos.map(p => p.id === editId ? upd : p) }));
        showToast("Puesto actualizado ✓");
      } else {
        const nuevo = await sb.insert("puestos", payload, token);
        setData(prev => ({ ...prev, puestos: [...prev.puestos, nuevo] }));
        showToast("Puesto añadido ✓");
      }
      setPModal(null);
    } catch { showToast("Error al guardar", "err"); }
  };

  const saveObra = async (form, editId) => {
    try {
      const payload = { empresa_id: eId, nombre: form.nombre, direccion: form.direccion || null };
      if (editId) {
        const upd = await sb.update("obras", editId, payload, token);
        setData(prev => ({ ...prev, obras: prev.obras.map(o => o.id === editId ? upd : o) }));
        showToast("Obra actualizada ✓");
      } else {
        const nuevo = await sb.insert("obras", payload, token);
        setData(prev => ({ ...prev, obras: [...prev.obras, nuevo] }));
        showToast("Obra añadida ✓");
      }
      setOModal(null);
    } catch { showToast("Error al guardar", "err"); }
  };

  const addAnticipo = async (wId, form) => {
    try {
      const nuevo = await sb.insert("anticipos", { empresa_id: eId, trabajador_id: wId, importe: parseFloat(form.importe), fecha: form.fecha, nota: form.nota || null }, token);
      setData(prev => ({ ...prev, anticipos: [...prev.anticipos, nuevo] }));
      showToast("Anticipo registrado ✓");
    } catch { showToast("Error al guardar", "err"); }
  };

  const deleteAnticipo = async (id) => {
    try {
      await sb.delete("anticipos", id, token);
      setData(prev => ({ ...prev, anticipos: prev.anticipos.filter(a => a.id !== id) }));
      showToast("Anticipo eliminado");
    } catch { showToast("Error al eliminar", "err"); }
  };

  const saveFactura = async (form, editId) => {
    try {
      const payload = { empresa_id: eId, numero: form.numero, fecha: form.fecha, vencimiento: form.vencimiento, estado: form.estado || "pendiente", cliente_id: form.cliente_id || null, cliente_snapshot: form.cliente, lineas: form.lineas, iva: form.iva || 21, notas: form.notas || null };
      if (editId) {
        const upd = await sb.update("facturas", editId, payload, token);
        setData(prev => ({ ...prev, facturas: prev.facturas.map(f => f.id === editId ? upd : f) }));
        showToast("Factura actualizada ✓");
        setFView(upd);
      } else {
        const nueva = await sb.insert("facturas", payload, token);
        setData(prev => ({ ...prev, facturas: [nueva, ...prev.facturas] }));
        showToast("Factura creada ✓");
        setFView(nueva);
      }
      setFModal(null);
    } catch { showToast("Error al guardar", "err"); }
  };

  const saveCliente = async (form, editId) => {
    try {
      if (editId) {
        const upd = await sb.update("clientes", editId, { empresa_id: eId, ...form }, token);
        setData(prev => ({ ...prev, clientes: prev.clientes.map(c => c.id === editId ? upd : c) }));
      } else {
        const nuevo = await sb.insert("clientes", { empresa_id: eId, ...form }, token);
        setData(prev => ({ ...prev, clientes: [...prev.clientes, nuevo] }));
      }
      showToast("Cliente guardado ✓");
    } catch { showToast("Error al guardar", "err"); }
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    const { type, id } = confirmDel;
    try {
      await sb.delete(type, id, token);
      const map = { trabajadores: "trabajadores", obras: "obras", puestos: "puestos", facturas: "facturas", clientes: "clientes" };
      if (map[type]) setData(prev => ({ ...prev, [map[type]]: prev[map[type]].filter(x => x.id !== id) }));
      if (type === "facturas") setFView(null);
      showToast("Eliminado correctamente");
    } catch { showToast("Error al eliminar", "err"); }
    setConfirmDel(null);
  };

  const changeEstadoFactura = async (id, estado) => {
    try {
      const upd = await sb.update("facturas", id, { estado }, token);
      setData(prev => ({ ...prev, facturas: prev.facturas.map(f => f.id === id ? upd : f) }));
      setFView(upd);
      showToast("Estado actualizado ✓");
    } catch { showToast("Error", "err"); }
  };

  const prevMonth = () => selMonth === 0 ? (setSelMonth(11), setSelYear(y => y - 1)) : setSelMonth(m => m - 1);
  const nextMonth = () => selMonth === 11 ? (setSelMonth(0), setSelYear(y => y + 1)) : setSelMonth(m => m + 1);

  const puestoColor = (pid) => { const idx = data.puestos.findIndex(p => p.id === pid); return PUESTO_COLORS[idx % PUESTO_COLORS.length] || "#64748b"; };
  const badge = (c) => ({ display: "inline-block", background: c + "22", color: c, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700 });
  const card  = { background: "#fff", borderRadius: 14, boxShadow: "0 1px 6px rgba(0,0,0,.08)", overflow: "hidden", marginBottom: 12 };
  const inp   = { width: "100%", border: "1px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box", color: "#1e293b", background: "#fff", fontFamily: "inherit" };

  const NAV = [
    ["asistencia", "📅", "Asistencia"],
    ["anticipos",  "💵", "Anticipos"],
    ["trabajadores","👷","Trabajadores"],
    ["obras",      "🏗️", "Obras"],
    ["puestos",    "🔧", "Puestos"],
    ["facturas",   "📄", "Facturas"],
    ["resumen",    "💰", "Resumen"],
  ];

  if (loading) return <Splash msg="Cargando tus datos..." />;

  return (
    <div style={{ fontFamily: "'Segoe UI',system-ui,sans-serif", minHeight: "100vh", background: "#F1F5F9", color: "#1e293b", overflowX: "hidden" }}>

      {/* HEADER */}
      <div style={{ background: "linear-gradient(135deg,#0F2444,#1B3E6E)", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", boxShadow: "0 2px 12px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>🏗️</span>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{APP_NAME}</div>
            <div style={{ color: "rgba(255,255,255,.55)", fontSize: 10 }}>{empresa.nombre}</div>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen(m => !m)} style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", color: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            ⚙️ Menú
          </button>
          {menuOpen && (
            <div style={{ position: "absolute", right: 0, top: 40, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.2)", padding: 8, minWidth: 180, zIndex: 99 }}>
              <div style={{ padding: "6px 10px", fontSize: 11, color: "#94a3b8", borderBottom: "1px solid #f0f4f8", marginBottom: 4 }}>{empresa.email}</div>
              {trialStatus !== "activo" && (
                <button onClick={() => { setMenuOpen(false); onPagar(); }} style={{ width: "100%", border: "none", background: "#FEF3C7", padding: "8px 10px", cursor: "pointer", fontSize: 13, color: "#92400E", textAlign: "left", fontWeight: 700, borderRadius: 6, marginBottom: 4 }}>
                  💳 Activar suscripción
                </button>
              )}
              <button onClick={() => { setMenuOpen(false); onLogout(); }} style={{ width: "100%", border: "none", background: "none", padding: "8px 10px", cursor: "pointer", fontSize: 13, color: "#ef4444", textAlign: "left", fontWeight: 600, borderRadius: 6 }}>
                🚪 Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>

      {/* TRIAL BANNER */}
      <TrialBanner daysLeft={daysLeft} trialStatus={trialStatus} onPagar={onPagar} />

      {/* NAV */}
      <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #E2E8F0", overflowX: "auto" }}>
        {NAV.map(([v, ic, l]) => (
          <button key={v} onClick={() => { setTab(v); setFView(null); setMenuOpen(false); }} style={{ padding: "10px 11px", border: "none", background: "none", cursor: "pointer", fontWeight: tab === v ? 700 : 400, color: tab === v ? "#0F2444" : "#64748b", borderBottom: tab === v ? "3px solid #0F2444" : "3px solid transparent", fontSize: 11, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>{ic} {l}</button>
        ))}
      </div>

      {/* MONTH BAR */}
      {!["puestos", "clientes"].includes(tab) && !fView && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "10px 16px", background: "#fff", borderBottom: "1px solid #E2E8F0" }}>
          <button onClick={prevMonth} style={{ border: "1px solid #ddd", background: "#f8fafc", borderRadius: 7, padding: "4px 13px", cursor: "pointer", fontSize: 17 }}>‹</button>
          <span style={{ fontWeight: 700, fontSize: 14, minWidth: 160, textAlign: "center" }}>{MONTHS[selMonth]} {selYear}</span>
          <button onClick={nextMonth} style={{ border: "1px solid #ddd", background: "#f8fafc", borderRadius: 7, padding: "4px 13px", cursor: "pointer", fontSize: 17 }}>›</button>
        </div>
      )}

      <div style={{ padding: 12 }}>

        {/* ASISTENCIA */}
        {tab === "asistencia" && (
          <div>
            {data.trabajadores.length === 0 && <EmptyMsg icon="👷" text="No hay trabajadores" sub="Ve a Trabajadores para añadir" />}
            {data.trabajadores.map(w => {
              const calc  = calcWorker(w);
              const color = puestoColor(w.puesto_id);
              const obra  = data.obras.find(o => o.id === w.obra_id);
              return (
                <div key={w.id} style={card}>
                  <div style={{ padding: "12px 14px", background: color + "0d", borderBottom: `3px solid ${color}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{w.nombre}</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
                        {calc.puesto && <span style={badge(color)}>{calc.puesto.nombre}</span>}
                        {obra && <span style={badge("#0891B2")}>🏗️ {obra.nombre}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{calc.diasTrab} peonada{calc.diasTrab !== 1 ? "s" : ""}</div>
                      <div style={{ fontWeight: 800, fontSize: 17, color }}>{fmt(calc.bruto)}</div>
                      {calc.antic > 0 && <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>- {fmt(calc.antic)} antic.</div>}
                      {calc.antic > 0 && <div style={{ fontSize: 12, color: "#059669", fontWeight: 700 }}>= {fmt(calc.pendiente)}</div>}
                    </div>
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 4 }}>
                      {DAY_LABELS.map((dl, i) => <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 600, color: i >= 5 ? "#94a3b8" : "#475569" }}>{dl}</div>)}
                    </div>
                    <CalGrid monthDays={monthDays} wId={w.id} color={color} isDayWorked={isDayWorked} toggleDay={toggleDay} />
                    <div style={{ marginTop: 6, fontSize: 10, color: "#94a3b8", textAlign: "right" }}>Toca un día para registrar peonada</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ANTICIPOS */}
        {tab === "anticipos" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              {[["Total anticipos", fmt(totales.antic), "#f59e0b"], ["Pendiente pagar", fmt(totales.pend), "#059669"]].map(([l, v, c]) => (
                <div key={l} style={{ ...card, padding: 14, borderTop: `3px solid ${c}`, textAlign: "center", marginBottom: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: c, textTransform: "uppercase" }}>{l}</div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: "#0F2444", marginTop: 4 }}>{v}</div>
                </div>
              ))}
            </div>
            {data.trabajadores.map(w => {
              const calc  = calcWorker(w);
              const color = puestoColor(w.puesto_id);
              return (
                <div key={w.id} style={card}>
                  <div style={{ padding: "12px 14px", background: color + "0d", borderBottom: `2px solid ${color}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{w.nombre}</div>
                      {calc.puesto && <span style={badge(color)}>{calc.puesto.nombre}</span>}
                    </div>
                    <button onClick={() => setAModal(w.id)} style={{ background: color, color: "#fff", border: "none", borderRadius: 7, padding: "7px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>+ Anticipo</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid #f0f4f8" }}>
                    {[["Devengado", fmt(calc.bruto), "#0F2444"], ["Anticipos", fmt(calc.antic), "#f59e0b"], ["Pendiente", fmt(calc.pendiente), "#059669"]].map(([l, v, c]) => (
                      <div key={l} style={{ padding: "10px 6px", textAlign: "center", borderRight: "1px solid #f0f4f8" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>{l}</div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: c, marginTop: 2 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {calc.antList.length === 0 ? (
                    <div style={{ padding: 14, textAlign: "center", color: "#b0bec5", fontSize: 12 }}>Sin anticipos este mes</div>
                  ) : (
                    calc.antList.map(a => (
                      <div key={a.id} style={{ padding: "10px 14px", borderBottom: "1px solid #f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <span style={{ fontWeight: 700, color: "#f59e0b", fontSize: 13 }}>{fmt(a.importe)}</span>
                          <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>{a.fecha}</span>
                          {a.nota && <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>· {a.nota}</span>}
                        </div>
                        <button onClick={() => deleteAnticipo(a.id)} style={{ border: "1px solid #fecaca", background: "#fff5f5", color: "#ef4444", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}>🗑️</button>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TRABAJADORES */}
        {tab === "trabajadores" && (
          <div>
            <button onClick={() => setWModal({ mode: "new" })} style={{ background: "#0F2444", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13, marginBottom: 12 }}>+ Nuevo trabajador</button>
            {data.trabajadores.length === 0 && <EmptyMsg icon="👷" text="No hay trabajadores" sub="Añade tu primer trabajador" />}
            {data.trabajadores.map(w => {
              const calc  = calcWorker(w);
              const color = puestoColor(w.puesto_id);
              const obra  = data.obras.find(o => o.id === w.obra_id);
              return (
                <div key={w.id} style={{ ...card, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 42, height: 42, borderRadius: "50%", background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👷</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{w.nombre}</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }}>
                        {calc.puesto && <span style={badge(color)}>{calc.puesto.nombre}</span>}
                        {obra && <span style={badge("#0891B2")}>🏗️ {obra.nombre}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{calc.puesto?.peonada}€/peonada · {calc.diasTrab} días · {fmt(calc.bruto)}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setAModal(w.id)} style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>💵</button>
                    <button onClick={() => setWModal({ mode: "edit", w })} style={{ border: "1px solid #ddd", background: "#f8fafc", borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>✏️</button>
                    <button onClick={() => setConfirmDel({ type: "trabajadores", id: w.id })} style={{ border: "1px solid #fecaca", background: "#fff5f5", color: "#ef4444", borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>🗑️</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* OBRAS */}
        {tab === "obras" && (
          <div>
            <button onClick={() => setOModal({ mode: "new" })} style={{ background: "#0F2444", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13, marginBottom: 12 }}>+ Nueva obra</button>
            {data.obras.length === 0 && <EmptyMsg icon="🏗️" text="No hay obras" sub="Añade tu primera obra" />}
            {data.obras.map(o => {
              const st = obraStats.find(x => x.id === o.id);
              return (
                <div key={o.id} style={{ ...card, borderLeft: "4px solid #0891B2" }}>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: "#0F2444" }}>🏗️ {o.nombre}</div>
                        {o.direccion && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>📍 {o.direccion}</div>}
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{st?.numW || 0} trabajadores asignados</div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setOModal({ mode: "edit", o })} style={{ border: "1px solid #ddd", background: "#f8fafc", borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>✏️</button>
                        <button onClick={() => setConfirmDel({ type: "obras", id: o.id })} style={{ border: "1px solid #fecaca", background: "#fff5f5", color: "#ef4444", borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>🗑️</button>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                      {[["Peonadas " + MONTHS[selMonth], (st?.peonadas || 0) + " peonadas", "#EFF6FF", "#1e3a5f"], ["Coste " + MONTHS[selMonth], fmt(st?.coste || 0), "#F0FDF4", "#059669"]].map(([l, v, bg, c]) => (
                        <div key={l} style={{ background: bg, borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>{l}</div>
                          <div style={{ fontWeight: 800, fontSize: 16, color: c, marginTop: 2 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {st?.wList?.length > 0 && (
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {st.wList.map(w => <span key={w.id} style={badge(puestoColor(w.puesto_id))}>👷 {w.nombre}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* PUESTOS */}
        {tab === "puestos" && (
          <div>
            <button onClick={() => setPModal({ mode: "new" })} style={{ background: "#0F2444", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13, marginBottom: 12 }}>+ Nuevo puesto</button>
            <div style={{ ...card, overflow: "hidden" }}>
              {data.puestos.length === 0 && <EmptyMsg icon="🔧" text="Sin puestos" />}
              {data.puestos.map((p, i) => {
                const color = puestoColor(p.id);
                const used  = data.trabajadores.filter(w => w.puesto_id === p.id).length;
                return (
                  <div key={p.id} style={{ padding: "12px 16px", borderBottom: i < data.puestos.length - 1 ? "1px solid #f0f4f8" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={badge(color)}>{p.nombre}</span>
                      {used > 0 && <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 6 }}>{used} trab.</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontWeight: 700, color: "#0F2444", fontSize: 15 }}>{p.peonada}€</span>
                      <button onClick={() => setPModal({ mode: "edit", p })} style={{ border: "1px solid #ddd", background: "#f8fafc", borderRadius: 6, padding: "5px 8px", cursor: "pointer", fontSize: 11 }}>✏️</button>
                      <button onClick={() => { if (used > 0) { showToast("Hay trabajadores con este puesto", "err"); return; } setConfirmDel({ type: "puestos", id: p.id }); }} style={{ border: "1px solid #fecaca", background: "#fff5f5", color: "#ef4444", borderRadius: 6, padding: "5px 8px", cursor: "pointer", fontSize: 11 }}>🗑️</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* FACTURAS */}
        {tab === "facturas" && !fView && (
          <FacturasLista facturas={data.facturas} calcTotals={calcFacturaTotals} onNew={() => setFModal({ mode: "new" })} onView={f => setFView(f)} />
        )}
        {tab === "facturas" && fView && (
          <FacturaVer
            factura={data.facturas.find(f => f.id === fView.id) || fView}
            calcTotals={calcFacturaTotals} empresa={empresa}
            onBack={() => setFView(null)} onEdit={f => setFModal({ mode: "edit", f })}
            onDelete={id => setConfirmDel({ type: "facturas", id })}
            onEstado={changeEstadoFactura}
          />
        )}

        {/* RESUMEN */}
        {tab === "resumen" && (
          <ResumenTab totales={totales} trabajadores={data.trabajadores} obras={obraStats} facturas={data.facturas} calcFacturaTotals={calcFacturaTotals} puestoColor={puestoColor} badge={badge} card={card} selMonth={selMonth} selYear={selYear} calcWorker={calcWorker} obrasList={data.obras} fmt={fmt} MONTHS={MONTHS} />
        )}
      </div>

      {/* MODALS */}
      {wModal && <WorkerModal modal={wModal} puestos={data.puestos} obras={data.obras} onClose={() => setWModal(null)} onSave={saveWorker} inp={inp} />}
      {pModal && <PuestoModal modal={pModal} onClose={() => setPModal(null)} onSave={savePuesto} inp={inp} />}
      {oModal && <ObraModal modal={oModal} onClose={() => setOModal(null)} onSave={saveObra} inp={inp} />}
      {aModal && <AnticiposModal worker={data.trabajadores.find(w => w.id === aModal)} calc={calcWorker(data.trabajadores.find(w => w.id === aModal) || {})} selMonth={selMonth} selYear={selYear} onClose={() => setAModal(null)} onAdd={addAnticipo} onDelete={deleteAnticipo} inp={inp} MONTHS={MONTHS} fmt={fmt} />}
      {fModal && <FacturaForm modal={fModal} clientes={data.clientes} nextNum={nextFacturaNum(data.facturas)} empresa={empresa} onClose={() => setFModal(null)} onSave={saveFactura} onSaveCliente={saveCliente} inp={inp} />}

      {/* CONFIRM DELETE */}
      {confirmDel && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, maxWidth: 300, width: "100%", textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,.25)" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🗑️</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>¿Eliminar?</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Esta acción no se puede deshacer.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDel(null)} style={{ flex: 1, border: "1px solid #ddd", background: "#f8fafc", borderRadius: 8, padding: 11, cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
              <button onClick={doDelete} style={{ flex: 1, background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, padding: 11, cursor: "pointer", fontWeight: 700 }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: toast.type === "err" ? "#ef4444" : "#059669", color: "#fff", padding: "11px 24px", borderRadius: 30, fontWeight: 700, fontSize: 13, boxShadow: "0 4px 20px rgba(0,0,0,.25)", zIndex: 200, whiteSpace: "nowrap" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function getDaysInMonth(year, month) {
  const result = [];
  const total  = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= total; d++) result.push({ d, dow: (new Date(year, month, d).getDay() + 6) % 7 });
  return result;
}

function nextFacturaNum(facturas) {
  const nums = facturas.map(f => parseInt(f.numero.replace(/\D/g, "")) || 0);
  return "FAC" + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(5, "0");
}

function CalGrid({ monthDays, wId, color, isDayWorked, toggleDay }) {
  const cells    = [];
  const firstDow = monthDays[0] ? monthDays[0].dow : 0;
  for (let i = 0; i < firstDow; i++) cells.push(<div key={"e" + i} />);
  monthDays.forEach(function(dayObj) {
    const d = dayObj.d, dow = dayObj.dow;
    const active = isDayWorked(wId, d), isWE = dow >= 5;
    cells.push(
      <button key={d} onClick={() => toggleDay(wId, d)} style={{ border: active ? "2px solid " + color : "1.5px solid #e2e8f0", borderRadius: 7, padding: "5px 2px", cursor: "pointer", textAlign: "center", background: active ? color : isWE ? "#f8fafc" : "#fff", color: active ? "#fff" : isWE ? "#b0b8c8" : "#334155", fontSize: 12, fontWeight: active ? 700 : 400, lineHeight: 1.3, boxShadow: active ? "0 2px 5px " + color + "55" : "none" }}>
        <div>{d}</div><div style={{ fontSize: 9 }}>{active ? "✓" : "·"}</div>
      </button>
    );
  });
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>{cells}</div>;
}

function WorkerModal({ modal, puestos, obras, onClose, onSave, inp }) {
  const w = modal.mode === "edit" ? modal.w : null;
  const [form, setForm] = useState({ nombre: w?.nombre || "", puesto_id: w?.puesto_id || "", obra_id: w?.obra_id || "" });
  const selPuesto = puestos.find(p => p.id === form.puesto_id);
  return (
    <Moda title={modal.mode === "new" ? "Nuevo trabajador" : "Editar trabajador"} onClose={onClose} onSave={() => onSave(form, w?.id)}>
      <Fld label="Nombre completo"><input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Juan García" style={inp} /></Fld>
      <Fld label="Puesto de trabajo">
        <select value={form.puesto_id} onChange={e => setForm(f => ({ ...f, puesto_id: e.target.value }))} style={inp}>
          <option value="">— Selecciona un puesto —</option>
          {puestos.map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.peonada}€/peonada</option>)}
        </select>
      </Fld>
      <Fld label="Obra asignada">
        <select value={form.obra_id} onChange={e => setForm(f => ({ ...f, obra_id: e.target.value }))} style={inp}>
          <option value="">— Sin obra asignada —</option>
          {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
      </Fld>
      {selPuesto && <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: "#0F2444", fontWeight: 600 }}>💰 Peonada: {selPuesto.peonada}€/día</div>}
    </Moda>
  );
}

function PuestoModal({ modal, onClose, onSave, inp }) {
  const p = modal.mode === "edit" ? modal.p : null;
  const [form, setForm] = useState({ nombre: p?.nombre || "", peonada: p?.peonada || "" });
  return (
    <Moda title={modal.mode === "new" ? "Nuevo puesto" : "Editar puesto"} onClose={onClose} onSave={() => onSave(form, p?.id)}>
      <Fld label="Nombre del puesto"><input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Oficial de 1ª" style={inp} /></Fld>
      <Fld label="Precio por peonada (€)"><input type="number" value={form.peonada} onChange={e => setForm(f => ({ ...f, peonada: e.target.value }))} placeholder="Ej: 95" style={inp} /></Fld>
    </Moda>
  );
}

function ObraModal({ modal, onClose, onSave, inp }) {
  const o = modal.mode === "edit" ? modal.o : null;
  const [form, setForm] = useState({ nombre: o?.nombre || "", direccion: o?.direccion || "" });
  return (
    <Moda title={modal.mode === "new" ? "Nueva obra" : "Editar obra"} onClose={onClose} onSave={() => onSave(form, o?.id)}>
      <Fld label="Nombre de la obra"><input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Urbanización Los Pinos" style={inp} /></Fld>
      <Fld label="Dirección (opcional)"><input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} placeholder="Ej: Calle Mayor 12, Arcos" style={inp} /></Fld>
    </Moda>
  );
}

function AnticiposModal({ worker, calc, selMonth, selYear, onClose, onAdd, onDelete, inp, MONTHS, fmt }) {
  const [form, setForm] = useState({ importe: "", fecha: new Date().toISOString().slice(0, 10), nota: "" });
  if (!worker) return null;
  const handleAdd = () => {
    if (!form.importe || parseFloat(form.importe) <= 0) return;
    onAdd(worker.id, form);
    setForm(f => ({ ...f, importe: "", nota: "" }));
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: 24, width: "100%", maxWidth: 480, boxShadow: "0 -4px 24px rgba(0,0,0,.2)", maxHeight: "82vh", overflowY: "auto", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
        <div style={{ fontWeight: 700, fontSize: 17, color: "#0F2444", marginBottom: 2 }}>💵 Anticipos — {worker.nombre}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>{MONTHS[selMonth]} {selYear}</div>
        <div style={{ background: "#FFFBEB", borderRadius: 12, padding: 14, marginBottom: 16, border: "1px solid #FDE68A" }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#92400E", marginBottom: 10 }}>Registrar nuevo anticipo</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <Fld label="Importe (€)"><input type="number" value={form.importe} onChange={e => setForm(f => ({ ...f, importe: e.target.value }))} placeholder="0.00" style={inp} /></Fld>
            <Fld label="Fecha"><input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} style={inp} /></Fld>
          </div>
          <Fld label="Nota (opcional)"><input value={form.nota} onChange={e => setForm(f => ({ ...f, nota: e.target.value }))} placeholder="Ej: Anticipo semanal" style={inp} /></Fld>
          <button onClick={handleAdd} style={{ marginTop: 10, width: "100%", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>+ Añadir anticipo</button>
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#475569", marginBottom: 8 }}>Anticipos de {MONTHS[selMonth]} · Total: {fmt(calc ? calc.antic : 0)}</div>
        {(!calc || calc.antList.length === 0) ? (
          <div style={{ textAlign: "center", color: "#b0bec5", padding: 16, fontSize: 12 }}>Sin anticipos este mes</div>
        ) : (
          calc.antList.map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#f8fafc", borderRadius: 8, marginBottom: 6 }}>
              <div>
                <span style={{ fontWeight: 700, color: "#f59e0b", fontSize: 14 }}>{fmt(a.importe)}</span>
                <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>{a.fecha}</span>
                {a.nota && <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>· {a.nota}</span>}
              </div>
              <button onClick={() => onDelete(a.id)} style={{ border: "1px solid #fecaca", background: "#fff5f5", color: "#ef4444", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}>🗑️</button>
            </div>
          ))
        )}
        <button onClick={onClose} style={{ marginTop: 16, width: "100%", border: "1px solid #ddd", background: "#f8fafc", borderRadius: 8, padding: 11, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Cerrar</button>
      </div>
    </div>
  );
}

const ESTADOS_FACTURA = {
  pendiente: { label: "Pendiente", bg: "#FEF3C7", col: "#92400E", dot: "#F59E0B" },
  cobrada:   { label: "Cobrada",   bg: "#D1FAE5", col: "#065F46", dot: "#10B981" },
  vencida:   { label: "Vencida",   bg: "#FEE2E2", col: "#991B1B", dot: "#EF4444" },
};

function FacturasLista({ facturas, calcTotals, onNew, onView }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("todas");
  const filtered = facturas.filter(f => {
    const q    = search.toLowerCase();
    const snap = f.cliente_snapshot || {};
    return (!q || f.numero.toLowerCase().includes(q) || (snap.nombre || "").toLowerCase().includes(q)) && (filter === "todas" || f.estado === filter);
  });
  const totPend = facturas.filter(f => f.estado === "pendiente").reduce((s, f) => s + calcTotals(f).total, 0);
  const totCobr = facturas.filter(f => f.estado === "cobrada").reduce((s, f) => s + calcTotals(f).total, 0);
  const fmt2 = (n) => Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + "€";
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        {[["Por cobrar", totPend, "#F59E0B", "#FFFBEB"], ["Cobrado", totCobr, "#10B981", "#F0FDF4"]].map(([l, v, c, bg]) => (
          <div key={l} style={{ background: bg, borderRadius: 12, padding: "12px 14px", borderLeft: `4px solid ${c}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: c, textTransform: "uppercase" }}>{l}</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#0F2444", marginTop: 4 }}>{fmt2(v)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Buscar..." style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 9, padding: "9px 12px", fontSize: 13, outline: "none" }} />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ border: "1px solid #E2E8F0", borderRadius: 9, padding: "9px 10px", fontSize: 13, background: "#fff" }}>
          <option value="todas">Todas</option>
          <option value="pendiente">Pendientes</option>
          <option value="cobrada">Cobradas</option>
          <option value="vencida">Vencidas</option>
        </select>
        <button onClick={onNew} style={{ background: "#0F2444", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}>+ Nueva</button>
      </div>
      <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.08)" }}>
        {filtered.length === 0 && <EmptyMsg icon="📄" text="No hay facturas" sub="Crea tu primera factura" />}
        {filtered.map((f, i) => {
          const { total } = calcTotals(f);
          const est  = ESTADOS_FACTURA[f.estado];
          const snap = f.cliente_snapshot || {};
          return (
            <div key={f.id} onClick={() => onView(f)} style={{ padding: "13px 16px", borderBottom: i < filtered.length - 1 ? "1px solid #F1F5F9" : "none", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
              onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"}
              onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: est?.dot, flexShrink: 0 }} />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "#0F2444" }}>{f.numero}</span>
                    <span style={{ background: est?.bg, color: est?.col, padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700 }}>{est?.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 1 }}>{snap.nombre || "Sin cliente"}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{f.fecha}</div>
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#0F2444", whiteSpace: "nowrap" }}>{fmt2(total)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FacturaVer({ factura, calcTotals, empresa, onBack, onEdit, onDelete, onEstado }) {
  const { base, ivaAmt, total } = calcTotals(factura);
  const snap   = factura.cliente_snapshot || {};
  const lineas = Array.isArray(factura.lineas) ? factura.lineas : [];
  const fmt2   = (n) => Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + "€";
  const est    = ESTADOS_FACTURA[factura.estado];
  const handlePrint = () => {
    const el = document.getElementById("factura-print-area");
    if (!el) return;
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${factura.numero}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#fff;color:#1a1a1a}</style></head><body>${el.innerHTML}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>← Volver</button>
        <button onClick={() => onEdit(factura)} style={{ background: "#0F2444", color: "#fff", border: "none", borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>✏️ Editar</button>
        <button onClick={handlePrint} style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>🖨️ PDF</button>
        <select value={factura.estado} onChange={e => onEstado(factura.id, e.target.value)} style={{ border: `2px solid ${est?.dot}`, borderRadius: 9, padding: "8px 12px", fontSize: 13, background: est?.bg, color: est?.col, fontWeight: 700, cursor: "pointer" }}>
          {Object.entries(ESTADOS_FACTURA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={() => onDelete(factura.id)} style={{ background: "#FEF2F2", color: "#EF4444", border: "1px solid #FECACA", borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13, marginLeft: "auto" }}>🗑️</button>
      </div>
      <div id="factura-print-area">
        <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,.1)", fontFamily: "Arial,sans-serif" }}>
          <div style={{ background: "linear-gradient(135deg,#0F2444,#1B3E6E)", padding: "24px 28px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: 22 }}>🏗️ {empresa.nombre}</div>
              <div style={{ color: "rgba(255,255,255,.65)", fontSize: 11, marginTop: 6, lineHeight: 1.8 }}>{empresa.email}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "rgba(255,255,255,.5)", fontSize: 10, letterSpacing: 2, textTransform: "uppercase" }}>Factura</div>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: 26 }}>{factura.numero}</div>
              <div style={{ color: "rgba(255,255,255,.65)", fontSize: 12, marginTop: 4, lineHeight: 1.8 }}>
                <b style={{ color: "rgba(255,255,255,.85)" }}>Fecha:</b> {factura.fecha}<br />
                <b style={{ color: "rgba(255,255,255,.85)" }}>Vencimiento:</b> {factura.vencimiento}
              </div>
              <div style={{ marginTop: 10, background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "10px 18px", border: "1px solid rgba(255,255,255,.2)" }}>
                <div style={{ color: "rgba(255,255,255,.6)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>Total</div>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: 20 }}>{fmt2(total)}</div>
              </div>
            </div>
          </div>
          <div style={{ height: 4, background: "linear-gradient(90deg,#F59E0B,#EF4444,#0F2444)" }} />
          <div style={{ padding: "24px 28px" }}>
            {snap.nombre && (
              <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "14px 18px", marginBottom: 20, borderLeft: "4px solid #0F2444" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>Cliente</div>
                <div style={{ fontWeight: 800, fontSize: 15, color: "#0F2444" }}>{snap.nombre}</div>
                <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.8, marginTop: 4 }}>
                  {snap.nif && <>{snap.nif}<br /></>}
                  {snap.direccion && <>{snap.direccion}<br /></>}
                  {snap.cp && snap.ciudad && <>{snap.cp} {snap.ciudad}<br /></>}
                  {snap.telefono && <>{snap.telefono}<br /></>}
                  {snap.email && snap.email}
                </div>
              </div>
            )}
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
              <thead>
                <tr style={{ background: "#0F2444" }}>
                  {["Descripción", "Cant.", "Precio unit.", "Total"].map((h, i) => (
                    <th key={h} style={{ padding: "10px 12px", color: "#fff", fontSize: 12, fontWeight: 700, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => {
                  const lt = (parseFloat(l.cantidad) || 0) * (parseFloat(l.precio) || 0);
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                      <td style={{ padding: "11px 12px", fontSize: 13 }}>{l.descripcion}</td>
                      <td style={{ padding: "11px 12px", fontSize: 13, textAlign: "right" }}>{l.cantidad}</td>
                      <td style={{ padding: "11px 12px", fontSize: 13, textAlign: "right" }}>{fmt2(parseFloat(l.precio) || 0)}</td>
                      <td style={{ padding: "11px 12px", fontSize: 13, fontWeight: 700, textAlign: "right" }}>{fmt2(lt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
              <div style={{ minWidth: 240, background: "#F8FAFC", borderRadius: 12, overflow: "hidden", border: "1px solid #E2E8F0" }}>
                {[["Base imponible", base], [`IVA (${factura.iva}%)`, ivaAmt]].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #E2E8F0", fontSize: 13, color: "#475569" }}>
                    <span>{l}</span><span style={{ fontWeight: 600 }}>{fmt2(v)}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "13px 16px", background: "#0F2444", fontWeight: 800, fontSize: 16, color: "#fff" }}>
                  <span>TOTAL</span><span>{fmt2(total)}</span>
                </div>
              </div>
            </div>
            {factura.notas && <div style={{ background: "#EFF6FF", borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "#475569", borderLeft: "4px solid #3B82F6" }}><b style={{ color: "#1D4ED8" }}>Notas: </b>{factura.notas}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function FacturaForm({ modal, clientes, nextNum, empresa, onClose, onSave, onSaveCliente, inp }) {
  const f = modal.mode === "edit" ? modal.f : null;
  const snap = f?.cliente_snapshot || {};
  const [form, setForm] = useState({
    numero: f?.numero || nextNum, fecha: f?.fecha || new Date().toISOString().slice(0, 10),
    vencimiento: f?.vencimiento || "Al recibir", estado: f?.estado || "pendiente",
    cliente_id: f?.cliente_id || "", cliente: snap.nombre ? snap : { nombre: "", nif: "", direccion: "", ciudad: "", cp: "", telefono: "", email: "" },
    lineas: f?.lineas?.length ? f.lineas : [{ id: 1, descripcion: "", cantidad: 1, precio: "" }],
    iva: f?.iva || 21, notas: f?.notas || "",
  });
  const setC = (k, v) => setForm(p => ({ ...p, cliente: { ...p.cliente, [k]: v } }));
  const setL = (id, k, v) => setForm(p => ({ ...p, lineas: p.lineas.map(l => l.id === id ? { ...l, [k]: v } : l) }));
  const addL = () => setForm(p => ({ ...p, lineas: [...p.lineas, { id: Date.now(), descripcion: "", cantidad: 1, precio: "" }] }));
  const delL = (id) => setForm(p => ({ ...p, lineas: p.lineas.filter(l => l.id !== id) }));
  const loadCliente = (cid) => { const c = clientes.find(x => x.id === cid); if (c) setForm(p => ({ ...p, cliente_id: cid, cliente: { nombre: c.nombre, nif: c.nif || "", direccion: c.direccion || "", ciudad: c.ciudad || "", cp: c.cp || "", telefono: c.telefono || "", email: c.email || "" } })); };
  const base  = form.lineas.reduce((s, l) => s + (parseFloat(l.cantidad) || 0) * (parseFloat(l.precio) || 0), 0);
  const total = base * (1 + form.iva / 100);
  const fmt2  = (n) => Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + "€";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 50, padding: 12, overflowY: "auto" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#F1F5F9", borderRadius: 16, width: "100%", maxWidth: 560, boxShadow: "0 8px 40px rgba(0,0,0,.3)", marginTop: 8, overflow: "hidden", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
        <div style={{ background: "#0F2444", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>{f ? "Editar factura" : "Nueva factura"}</div>
          <div style={{ background: "rgba(255,255,255,.15)", color: "#fff", borderRadius: 8, padding: "6px 14px", fontWeight: 800, fontSize: 15 }}>Total: {fmt2(total)}</div>
        </div>
        <div style={{ padding: 16, maxHeight: "75vh", overflowY: "auto" }}>
          <Sec title="Datos de la factura">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <Fld label="Número"><input style={inp} value={form.numero} onChange={e => setForm(p => ({ ...p, numero: e.target.value }))} /></Fld>
              <Fld label="Fecha"><input style={inp} type="date" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} /></Fld>
              <Fld label="Vencimiento"><input style={inp} value={form.vencimiento} onChange={e => setForm(p => ({ ...p, vencimiento: e.target.value }))} /></Fld>
            </div>
          </Sec>
          <Sec title="Cliente">
            {clientes.length > 0 && <div style={{ marginBottom: 10 }}><Fld label="Cargar cliente"><select onChange={e => loadCliente(e.target.value)} style={inp}><option value="">— Seleccionar —</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Fld></div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Fld label="Nombre"><input style={inp} value={form.cliente.nombre} onChange={e => setC("nombre", e.target.value)} /></Fld>
              <Fld label="NIF/CIF"><input style={inp} value={form.cliente.nif} onChange={e => setC("nif", e.target.value)} /></Fld>
              <Fld label="Dirección"><input style={inp} value={form.cliente.direccion} onChange={e => setC("direccion", e.target.value)} /></Fld>
              <Fld label="Ciudad"><input style={inp} value={form.cliente.ciudad} onChange={e => setC("ciudad", e.target.value)} /></Fld>
              <Fld label="C.P."><input style={inp} value={form.cliente.cp} onChange={e => setC("cp", e.target.value)} /></Fld>
              <Fld label="Teléfono"><input style={inp} value={form.cliente.telefono} onChange={e => setC("telefono", e.target.value)} /></Fld>
              <div style={{ gridColumn: "span 2" }}><Fld label="Email"><input style={inp} value={form.cliente.email} onChange={e => setC("email", e.target.value)} /></Fld></div>
            </div>
          </Sec>
          <Sec title="Líneas">
            {form.lineas.map((l, i) => {
              const lt = (parseFloat(l.cantidad) || 0) * (parseFloat(l.precio) || 0);
              return (
                <div key={l.id} style={{ background: "#F8FAFC", borderRadius: 10, padding: 12, marginBottom: 8, border: "1px solid #E2E8F0" }}>
                  <Fld label={"Descripción " + (i + 1)}><input style={inp} value={l.descripcion} onChange={e => setL(l.id, "descripcion", e.target.value)} placeholder="Descripción del trabajo" /></Fld>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8, alignItems: "end" }}>
                    <Fld label="Cantidad"><input style={inp} type="number" min="0" step="0.01" value={l.cantidad} onChange={e => setL(l.id, "cantidad", e.target.value)} /></Fld>
                    <Fld label="Precio (€)"><input style={inp} type="number" min="0" step="0.01" value={l.precio} onChange={e => setL(l.id, "precio", e.target.value)} placeholder="0.00" /></Fld>
                    {form.lineas.length > 1 && <button onClick={() => delL(l.id)} style={{ border: "1px solid #fecaca", background: "#fff5f5", color: "#ef4444", borderRadius: 8, padding: "9px 10px", cursor: "pointer", marginBottom: 1 }}>🗑️</button>}
                  </div>
                  {lt > 0 && <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: "#0F2444", marginTop: 6 }}>Subtotal: {fmt2(lt)}</div>}
                </div>
              );
            })}
            <button onClick={addL} style={{ width: "100%", border: "2px dashed #CBD5E1", background: "#F8FAFC", borderRadius: 10, padding: 10, cursor: "pointer", fontSize: 13, color: "#64748b", fontWeight: 600 }}>+ Añadir línea</button>
          </Sec>
          <Sec title="IVA">
            <Fld label="Tipo de IVA"><select value={form.iva} onChange={e => setForm(p => ({ ...p, iva: parseInt(e.target.value) }))} style={{ ...inp, width: 140 }}>{[0, 4, 10, 21].map(v => <option key={v} value={v}>{v}%</option>)}</select></Fld>
            <div style={{ background: "#F8FAFC", borderRadius: 10, overflow: "hidden", border: "1px solid #E2E8F0", marginTop: 10 }}>
              {[["Base imponible", base], [`IVA (${form.iva}%)`, base * form.iva / 100]].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #E2E8F0", fontSize: 13, color: "#475569" }}>
                  <span>{l}</span><span style={{ fontWeight: 600 }}>{fmt2(v)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: "#0F2444", fontWeight: 800, fontSize: 15, color: "#fff" }}>
                <span>TOTAL</span><span>{fmt2(total)}</span>
              </div>
            </div>
          </Sec>
          <Sec title="Notas (opcional)">
            <textarea style={{ ...inp, height: 70, resize: "vertical" }} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Observaciones..." />
          </Sec>
          <div style={{ display: "flex", gap: 10, marginTop: 4, paddingBottom: 8 }}>
            <button onClick={onClose} style={{ flex: 1, border: "1px solid #ddd", background: "#fff", borderRadius: 9, padding: 12, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Cancelar</button>
            <button onClick={() => onSave(form, f?.id)} style={{ flex: 2, background: "#0F2444", color: "#fff", border: "none", borderRadius: 9, padding: 12, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>💾 Guardar factura</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResumenTab({ totales, trabajadores, obras, facturas, calcFacturaTotals, puestoColor, badge, card, selMonth, selYear, calcWorker, obrasList, fmt, MONTHS }) {
  const totFact = facturas.reduce((s, f) => s + calcFacturaTotals(f).total, 0);
  const fmt2    = (n) => Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + "€";
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        {[["Peonadas", totales.dias + "", "📋", "#0F2444"], ["Bruto", fmt(totales.bruto), "💶", "#0F2444"], ["Anticipos", fmt(totales.antic), "💵", "#f59e0b"], ["A pagar", fmt(totales.pend), "✅", "#059669"]].map(([l, v, ic, c]) => (
          <div key={l} style={{ ...card, padding: 14, textAlign: "center", borderTop: `3px solid ${c}`, marginBottom: 0 }}>
            <div style={{ fontSize: 20 }}>{ic}</div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, textTransform: "uppercase", fontWeight: 700 }}>{l}</div>
            <div style={{ fontWeight: 800, fontSize: 17, color: c, marginTop: 2 }}>{v}</div>
            <div style={{ fontSize: 10, color: "#b0bec5" }}>{MONTHS[selMonth]} {selYear}</div>
          </div>
        ))}
      </div>
      <div style={card}>
        <div style={{ padding: "12px 16px", borderBottom: "2px solid #0F2444", fontWeight: 700, fontSize: 13 }}>Desglose por trabajador — {MONTHS[selMonth]}</div>
        {trabajadores.length === 0 && <EmptyMsg icon="👷" text="Sin trabajadores" />}
        {trabajadores.map((w, i) => {
          const calc  = calcWorker(w), color = puestoColor(w.puesto_id), obra = obrasList.find(o => o.id === w.obra_id);
          const pct   = totales.bruto > 0 ? (calc.bruto / totales.bruto) * 100 : 0;
          return (
            <div key={w.id} style={{ padding: "13px 16px", borderBottom: i < trabajadores.length - 1 ? "1px solid #f0f4f8" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{w.nombre}</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }}>
                    {calc.puesto && <span style={badge(color)}>{calc.puesto.nombre}</span>}
                    {obra && <span style={badge("#0891B2")}>🏗️ {obra.nombre}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{calc.diasTrab} peonadas × {calc.puesto?.peonada}€</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color }}>Bruto: {fmt(calc.bruto)}</div>
                  {calc.antic > 0 && <div style={{ fontSize: 12, color: "#f59e0b" }}>- Anticipo: {fmt(calc.antic)}</div>}
                  {calc.antic > 0 && <div style={{ fontSize: 13, fontWeight: 800, color: "#059669" }}>= Pagar: {fmt(calc.pendiente)}</div>}
                </div>
              </div>
              <div style={{ background: "#f0f4f8", borderRadius: 999, height: 5, overflow: "hidden" }}>
                <div style={{ background: `linear-gradient(90deg,${color},${color}cc)`, height: "100%", width: pct + "%", borderRadius: 999 }} />
              </div>
            </div>
          );
        })}
        {trabajadores.length > 0 && (
          <div style={{ padding: "13px 16px", background: "#EFF6FF", display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
            <div>
              <div style={{ color: "#0F2444", fontSize: 13 }}>TOTAL NÓMINA {MONTHS[selMonth].toUpperCase()}</div>
              {totales.antic > 0 && <div style={{ fontSize: 11, color: "#f59e0b" }}>Anticipos: {fmt(totales.antic)}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#0F2444", fontSize: 18 }}>{fmt(totales.bruto)}</div>
              {totales.antic > 0 && <div style={{ color: "#059669", fontSize: 13 }}>A pagar: {fmt(totales.pend)}</div>}
            </div>
          </div>
        )}
      </div>
      {obras.length > 0 && (
        <div style={card}>
          <div style={{ padding: "12px 16px", borderBottom: "2px solid #0891B2", fontWeight: 700, fontSize: 13, color: "#0891B2" }}>Peonadas por obra — {MONTHS[selMonth]}</div>
          {obras.map((o, i) => (
            <div key={o.id} style={{ padding: "12px 16px", borderBottom: i < obras.length - 1 ? "1px solid #f0f4f8" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>🏗️ {o.nombre}</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{o.numW} trabajadores · {o.peonadas} peonadas</div>
              </div>
              <div style={{ fontWeight: 700, color: "#0891B2", fontSize: 15 }}>{fmt(o.coste)}</div>
            </div>
          ))}
        </div>
      )}
      <div style={card}>
        <div style={{ padding: "12px 16px", borderBottom: "2px solid #F59E0B", fontWeight: 700, fontSize: 13, color: "#92400E" }}>Facturación total</div>
        {[["Pendiente de cobro", facturas.filter(f => f.estado === "pendiente").reduce((s, f) => s + calcFacturaTotals(f).total, 0), "#F59E0B"], ["Cobrado", facturas.filter(f => f.estado === "cobrada").reduce((s, f) => s + calcFacturaTotals(f).total, 0), "#10B981"], ["Total facturado", totFact, "#0F2444"]].map(([l, v, c]) => (
          <div key={l} style={{ padding: "12px 16px", borderBottom: "1px solid #f0f4f8", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#475569" }}>{l}</span>
            <span style={{ fontWeight: 700, color: c, fontSize: 14 }}>{fmt2(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Splash({ msg = "Cargando..." }) {
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0F2444,#1B3E6E)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>🏗️</div>
      <div style={{ color: "#fff", fontWeight: 800, fontSize: 24 }}>GestiónObras</div>
      <div style={{ color: "rgba(255,255,255,.6)", fontSize: 14, marginTop: 8 }}>{msg}</div>
    </div>
  );
}

function Moda({ title, onClose, onSave, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 400, boxShadow: "0 8px 32px rgba(0,0,0,.2)", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 18, color: "#0F2444" }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, border: "1px solid #ddd", background: "#f8fafc", borderRadius: 8, padding: 11, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Cancelar</button>
          <button onClick={onSave} style={{ flex: 1, background: "#0F2444", color: "#fff", border: "none", borderRadius: 8, padding: 11, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function Sec({ title, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
      {title && <div style={{ fontWeight: 700, fontSize: 12, color: "#0F2444", marginBottom: 10, paddingBottom: 7, borderBottom: "1px solid #F1F5F9", textTransform: "uppercase", letterSpacing: .5 }}>{title}</div>}
      {children}
    </div>
  );
}

function Fld({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: .3 }}>{label}</label>
      {children}
    </div>
  );
}

function EmptyMsg({ icon, text, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 16px" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 600, color: "#64748b", fontSize: 14 }}>{text}</div>
      {sub && <div style={{ color: "#b0bec5", fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
