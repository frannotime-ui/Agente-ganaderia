// Conexión del dashboard con la base de datos (solo lectura).
// La clave "publishable" es PÚBLICA por diseño: solo permite leer lo que las políticas de Supabase dejan leer.
// NUNCA pongas acá la clave secreta (service_role / sb_secret_...): quedaría visible para cualquiera.
window.APP_CONFIG = {
  SUPABASE_URL: "https://qeqjswjgpicpkojlpiwg.supabase.co",
  SUPABASE_KEY: "sb_publishable_wC3KGpEJzaLTAgaFonCenw_glBc5V1a",
};
