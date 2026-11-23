/**
 * Soundbranding WiWO: módulo portable, sin dependencias, extraído de Ops (ops-v2).
 *
 * Tres sonidos de marca reproducidos con Web Audio:
 * - `marca`: firma sonora de la intro de entrada (1,75 s).
 * - `exito`: un proceso lento terminó bien (1,6 s).
 * - `error`: algo que provocó la persona falló (1,5 s).
 *
 * Reglas que este módulo garantiza:
 * - No lanza nunca. Sin Web Audio, sin archivo, bloqueado o silenciado, las funciones devuelven `false`.
 * - Descarga y decodifica los MP3 solo en el primer gesto (pointerdown/keydown) y solo si el sonido
 *   está activado: quien lo tiene apagado nunca descarga los archivos.
 * - Freno anti-ráfaga: uno por segundo del mismo tipo y 300 ms entre tipos distintos.
 * - Preferencia de silencio en localStorage (`wiwo-sonidos` = `'apagados'`), compartida entre
 *   plataformas WiWO del mismo dominio y sincronizada entre pestañas.
 */

export type SonidoDeMarca = 'exito' | 'error' | 'marca'

/** Configuración ajustable por plataforma. */
export interface OpcionesSonidos {
  /** Carpeta pública donde se sirven los MP3. Por defecto `/sonidos`. */
  base?: string
  /** Volumen de 0 a 1. Los archivos vienen fuertes: Ops usa 0,5. */
  volumen?: number
}

export const CLAVE_SONIDOS = 'wiwo-sonidos'
export const EVENTO_SONIDOS = 'wiwo:sonidos'
export const ESPERA_MISMO_TIPO_MS = 1000
export const ESPERA_OTRO_TIPO_MS = 300

const ARCHIVOS: Record<SonidoDeMarca, string> = {
  exito: 'wiwo-sonic-success.mp3',
  error: 'wiwo-sonic-error.mp3',
  marca: 'wiwo-sonic-marca.mp3'
}

const EVENTOS_DE_GESTO = ['pointerdown', 'keydown'] as const

let base = '/sonidos'
let volumen = 0.5
let contexto: AudioContext | null = null
let preparacion: Promise<void> | null = null
let escuchando = false
const buffers = new Map<SonidoDeMarca, AudioBuffer>()

/* ---------- Preferencia de silencio ---------- */

/**
 * Lee si los sonidos están activados.
 *
 * @returns `false` solo si la persona los apagó; sin valor o sin almacenamiento, `true`
 */
export function leerSonidosActivos (): boolean {
  if (typeof window === 'undefined') return true

  try {
    return window.localStorage.getItem(CLAVE_SONIDOS) !== 'apagados'
  } catch {
    return true
  }
}

/**
 * Enciende o apaga los sonidos, lo recuerda y avisa a esta pestaña.
 *
 * @param activos `true` para que suenen, `false` para silenciarlos
 */
export function establecerSonidos (activos: boolean): void {
  if (typeof window === 'undefined') return

  try {
    if (activos) window.localStorage.removeItem(CLAVE_SONIDOS)
    else window.localStorage.setItem(CLAVE_SONIDOS, 'apagados')
  } catch {
    // Sin almacenamiento la preferencia rige solo en esta pestaña.
  }

  window.dispatchEvent(new Event(EVENTO_SONIDOS))
}

/**
 * Se suscribe a cambios de la preferencia (esta pestaña y las demás).
 * Sirve directo para `useSyncExternalStore` en React.
 *
 * @param avisar callback a ejecutar en cada cambio
 * @returns función para darse de baja
 */
export function suscribirSonidos (avisar: () => void): () => void {
  window.addEventListener(EVENTO_SONIDOS, avisar)
  window.addEventListener('storage', avisar)

  return () => {
    window.removeEventListener(EVENTO_SONIDOS, avisar)
    window.removeEventListener('storage', avisar)
  }
}

/* ---------- Freno anti-ráfaga ---------- */

/**
 * Crea un limitador de ráfagas.
 *
 * @param reloj milisegundos actuales; inyectable para pruebas
 * @returns objeto cuyo `permitir(tipo)` devuelve `true` y registra, o `false` sin registrar
 */
export function crearLimitador (reloj: () => number) {
  const ultimoPorTipo = new Map<SonidoDeMarca, number>()
  let ultimoCualquiera = Number.NEGATIVE_INFINITY

  return {
    permitir (tipo: SonidoDeMarca): boolean {
      const ahora = reloj()
      const ultimoDelTipo = ultimoPorTipo.get(tipo) ?? Number.NEGATIVE_INFINITY

      if (ahora - ultimoDelTipo < ESPERA_MISMO_TIPO_MS) return false
      if (ahora - ultimoCualquiera < ESPERA_OTRO_TIPO_MS) return false

      ultimoPorTipo.set(tipo, ahora)
      ultimoCualquiera = ahora

      return true
    }
  }
}

const limitador = crearLimitador(() => Date.now())

/* ---------- Carga y reproducción ---------- */

/**
 * Devuelve el AudioContext compartido, creándolo si hace falta.
 *
 * @returns el contexto, o `null` si no hay Web Audio
 */
function contextoDeAudio (): AudioContext | null {
  if (contexto !== null) return contexto
  if (typeof globalThis.AudioContext !== 'function') return null

  try {
    contexto = new AudioContext()
  } catch {
    return null
  }

  return contexto
}

/**
 * Descarga y decodifica un sonido.
 *
 * @param audio contexto que decodifica
 * @param tipo sonido a cargar
 * @throws Error si la descarga responde con estado no exitoso
 */
async function cargar (audio: AudioContext, tipo: SonidoDeMarca): Promise<void> {
  const respuesta = await fetch(`${base}/${ARCHIVOS[tipo]}`)

  if (!respuesta.ok) throw new Error(`sonido ${tipo}: ${respuesta.status}`)

  buffers.set(tipo, await audio.decodeAudioData(await respuesta.arrayBuffer()))
}

/** Quita las escuchas de gesto. */
function dejarDeEscuchar (): void {
  for (const evento of EVENTOS_DE_GESTO) globalThis.removeEventListener(evento, alPrimerGesto)
  escuchando = false
}

/** Primer gesto: crea/reanuda el contexto y descarga los tres MP3 (una sola vez). */
function alPrimerGesto (): void {
  if (!leerSonidosActivos()) return

  dejarDeEscuchar()

  const audio = contextoDeAudio()

  if (audio === null) return
  if (audio.state === 'suspended') void audio.resume().catch(() => undefined)
  if (preparacion !== null) return

  preparacion = Promise.all([cargar(audio, 'exito'), cargar(audio, 'error'), cargar(audio, 'marca')])
    .then(() => undefined)
    .catch(() => { preparacion = null })
}

/**
 * Deja los sonidos listos para cargarse en el primer gesto. Llamar una vez al montar la app.
 * Idempotente; no crea contexto ni descarga nada por sí misma.
 *
 * @param opciones carpeta pública y volumen
 */
export function prepararSonidosMarca (opciones: OpcionesSonidos = {}): void {
  base = opciones.base ?? base
  volumen = opciones.volumen ?? volumen

  if (escuchando || typeof globalThis.addEventListener !== 'function') return

  escuchando = true

  for (const evento of EVENTOS_DE_GESTO) globalThis.addEventListener(evento, alPrimerGesto, { passive: true })
}

/**
 * Reproduce un sonido si se puede.
 *
 * @param tipo sonido a reproducir
 * @returns `true` si sonó; `false` si estaba silenciado, frenado, sin cargar o bloqueado
 */
function sonar (tipo: SonidoDeMarca): boolean {
  try {
    if (!leerSonidosActivos()) return false

    const buffer = buffers.get(tipo)

    if (buffer === undefined) {
      if (preparacion === null) prepararSonidosMarca()
      return false
    }

    const audio = contextoDeAudio()

    if (audio === null) return false
    if (audio.state !== 'running') {
      void audio.resume().catch(() => undefined)
      return false
    }
    if (!limitador.permitir(tipo)) return false

    const fuente = audio.createBufferSource()
    const ganancia = audio.createGain()

    fuente.buffer = buffer
    ganancia.gain.value = volumen
    fuente.connect(ganancia).connect(audio.destination)
    fuente.start()

    return true
  } catch {
    return false
  }
}

/** Firma sonora de la marca (intro de entrada). @returns `true` si sonó */
export const sonarMarca = (): boolean => sonar('marca')

/** Proceso lento terminado con éxito. @returns `true` si sonó */
export const sonarExito = (): boolean => sonar('exito')

/** Error provocado por la persona. @returns `true` si sonó */
export const sonarError = (): boolean => sonar('error')

/**
 * Sonido al cerrar un lote (subidas, importaciones): solo cuando ya no queda nada en curso.
 *
 * @param listas cuántos terminaron bien
 * @param fallos cuántos fallaron (sin contar cancelados)
 * @param enCurso `true` si aún hay pendientes
 * @returns el sonido que corresponde, o `null`
 */
export function sonidoDelLote (listas: number, fallos: number, enCurso: boolean): 'exito' | 'error' | null {
  if (enCurso) return null
  if (fallos > 0) return 'error'

  return listas > 0 ? 'exito' : null
}
