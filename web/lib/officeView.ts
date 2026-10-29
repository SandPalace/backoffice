// Preferencia «Vista oficina»: la oficina 3D es una vista opcional; por defecto la app usa la interfaz 2D.
export const OFFICE_VIEW_KEY = 'backoffice.officeView'

/** Lo guardado en el navegador → ¿vista oficina encendida? Sólo 'on' la enciende; nada guardado (o basura) = apagada. */
export const parseOfficeView = (stored: string | null | undefined): boolean => stored === 'on'

/** Valor que se guarda para una elección. */
export const serializeOfficeView = (on: boolean): 'on' | 'off' => (on ? 'on' : 'off')

/** Lee la preferencia de un Storage; si el acceso falla (modo privado, bloqueado) queda apagada. */
export function readOfficeView(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try { return parseOfficeView(storage?.getItem(OFFICE_VIEW_KEY)) } catch { return false }
}

/** Guarda la preferencia; si el acceso falla sigue funcionando sólo durante esta visita. */
export function writeOfficeView(storage: Pick<Storage, 'setItem'> | null | undefined, on: boolean): void {
  try { storage?.setItem(OFFICE_VIEW_KEY, serializeOfficeView(on)) } catch { /* modo privado */ }
}
