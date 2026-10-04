/**
 * D158 · catálogo FINITO de presentación, no habilitación comercial.
 * Snapshot público local /usr/share/zoneinfo/zone.tab, sha256
 * 7cc78ea166261b3dedf951cdd721051460851e6fcd96c12b8e3194cf25677f21.
 * Dominio público (Arthur David Olson, 2009-05-17). Tabla de compatibilidad
 * deprecated: recomienda zone1970.tab, ausente local; no se afirma haberlo leído.
 * Contraste primario: https://data.iana.org/time-zones/tzdb/zone.tab.
 * Sólo códigos, identificadores y etiquetas; sin coordenadas/lectura del OS.
 * 7 países/62 pares: MX12, CO1, PE1, AR12, CL4, ES3, US29.
 * No cobertura mundial ni reglas legales: Intl del runtime aplica las reglas.
 * Existir aquí NO acredita soporte: cada opción debe comprobarse e inhabilitarse
 * si el navegador no la admite (incluida America/Coyhaique).
 */
export type CountryCode = 'MX' | 'CO' | 'PE' | 'AR' | 'CL' | 'ES' | 'US';

export interface RegionCountry {
  readonly code: CountryCode;
  readonly label: string;
  readonly zones: readonly string[];
}

export const REGION_COUNTRIES: readonly RegionCountry[] = [
  { code: 'MX', label: 'México', zones: [
    'America/Mexico_City', 'America/Cancun', 'America/Merida',
    'America/Monterrey', 'America/Matamoros', 'America/Chihuahua',
    'America/Ciudad_Juarez', 'America/Ojinaga', 'America/Mazatlan',
    'America/Bahia_Banderas', 'America/Hermosillo', 'America/Tijuana',
  ] },
  { code: 'CO', label: 'Colombia', zones: ['America/Bogota'] },
  { code: 'PE', label: 'Perú', zones: ['America/Lima'] },
  { code: 'AR', label: 'Argentina', zones: [
    'America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba',
    'America/Argentina/Salta', 'America/Argentina/Jujuy',
    'America/Argentina/Tucuman', 'America/Argentina/Catamarca',
    'America/Argentina/La_Rioja', 'America/Argentina/San_Juan',
    'America/Argentina/Mendoza', 'America/Argentina/San_Luis',
    'America/Argentina/Rio_Gallegos', 'America/Argentina/Ushuaia',
  ] },
  { code: 'CL', label: 'Chile', zones: [
    'America/Santiago', 'America/Coyhaique', 'America/Punta_Arenas', 'Pacific/Easter',
  ] },
  { code: 'ES', label: 'España', zones: ['Europe/Madrid', 'Africa/Ceuta', 'Atlantic/Canary'] },
  { code: 'US', label: 'Estados Unidos', zones: [
    'America/New_York', 'America/Detroit', 'America/Kentucky/Louisville',
    'America/Kentucky/Monticello', 'America/Indiana/Indianapolis',
    'America/Indiana/Vincennes', 'America/Indiana/Winamac',
    'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay',
    'America/Chicago', 'America/Indiana/Tell_City', 'America/Indiana/Knox',
    'America/Menominee', 'America/North_Dakota/Center',
    'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah',
    'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles',
    'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla',
    'America/Yakutat', 'America/Nome', 'America/Adak', 'Pacific/Honolulu',
  ] },
];

/** Etiquetas del catálogo recibido; cada ciudad conserva SU IANA.
 * D169 agrupa sólo la presentación por offset actual, nunca la persistencia:
 * coincidir ahora no implica reglas iguales.
 * Nombres propios originales, con exónimos legibles en inglés donde procede.
 */
const ZONE_LABELS: Readonly<Record<string, readonly [string, string]>> = {
  'America/Mexico_City': ['Ciudad de México', 'Mexico City'],
  'America/Cancun': ['Cancún', 'Cancún'],
  'America/Merida': ['Mérida', 'Mérida'],
  'America/Monterrey': ['Monterrey', 'Monterrey'],
  'America/Matamoros': ['Matamoros', 'Matamoros'],
  'America/Chihuahua': ['Chihuahua', 'Chihuahua'],
  'America/Ciudad_Juarez': ['Ciudad Juárez', 'Ciudad Juárez'],
  'America/Ojinaga': ['Ojinaga', 'Ojinaga'],
  'America/Mazatlan': ['Mazatlán', 'Mazatlán'],
  'America/Bahia_Banderas': ['Bahía de Banderas', 'Bahía de Banderas'],
  'America/Hermosillo': ['Hermosillo', 'Hermosillo'],
  'America/Tijuana': ['Tijuana', 'Tijuana'],
  'America/Bogota': ['Bogotá', 'Bogotá'],
  'America/Lima': ['Lima', 'Lima'],
  'America/Argentina/Buenos_Aires': ['Buenos Aires', 'Buenos Aires'],
  'America/Argentina/Cordoba': ['Córdoba', 'Córdoba'],
  'America/Argentina/Salta': ['Salta', 'Salta'],
  'America/Argentina/Jujuy': ['Jujuy', 'Jujuy'],
  'America/Argentina/Tucuman': ['Tucumán', 'Tucumán'],
  'America/Argentina/Catamarca': ['Catamarca', 'Catamarca'],
  'America/Argentina/La_Rioja': ['La Rioja', 'La Rioja'],
  'America/Argentina/San_Juan': ['San Juan', 'San Juan'],
  'America/Argentina/Mendoza': ['Mendoza', 'Mendoza'],
  'America/Argentina/San_Luis': ['San Luis', 'San Luis'],
  'America/Argentina/Rio_Gallegos': ['Río Gallegos', 'Río Gallegos'],
  'America/Argentina/Ushuaia': ['Ushuaia', 'Ushuaia'],
  'America/Santiago': ['Santiago', 'Santiago'],
  'America/Coyhaique': ['Coyhaique', 'Coyhaique'],
  'America/Punta_Arenas': ['Punta Arenas', 'Punta Arenas'],
  'Pacific/Easter': ['Isla de Pascua (Rapa Nui)', 'Easter Island (Rapa Nui)'],
  'Europe/Madrid': ['Madrid', 'Madrid'],
  'Africa/Ceuta': ['Ceuta', 'Ceuta'],
  'Atlantic/Canary': ['Islas Canarias', 'Canary Islands'],
  'America/New_York': ['Nueva York', 'New York'],
  'America/Detroit': ['Detroit', 'Detroit'],
  'America/Kentucky/Louisville': ['Louisville, Kentucky', 'Louisville, Kentucky'],
  'America/Kentucky/Monticello': ['Monticello, Kentucky', 'Monticello, Kentucky'],
  'America/Indiana/Indianapolis': ['Indianápolis, Indiana', 'Indianapolis, Indiana'],
  'America/Indiana/Vincennes': ['Vincennes, Indiana', 'Vincennes, Indiana'],
  'America/Indiana/Winamac': ['Winamac, Indiana', 'Winamac, Indiana'],
  'America/Indiana/Marengo': ['Marengo, Indiana', 'Marengo, Indiana'],
  'America/Indiana/Petersburg': ['Petersburg, Indiana', 'Petersburg, Indiana'],
  'America/Indiana/Vevay': ['Vevay, Indiana', 'Vevay, Indiana'],
  'America/Chicago': ['Chicago', 'Chicago'],
  'America/Indiana/Tell_City': ['Tell City, Indiana', 'Tell City, Indiana'],
  'America/Indiana/Knox': ['Knox, Indiana', 'Knox, Indiana'],
  'America/Menominee': ['Menominee', 'Menominee'],
  'America/North_Dakota/Center': ['Center, Dakota del Norte', 'Center, North Dakota'],
  'America/North_Dakota/New_Salem': ['New Salem, Dakota del Norte', 'New Salem, North Dakota'],
  'America/North_Dakota/Beulah': ['Beulah, Dakota del Norte', 'Beulah, North Dakota'],
  'America/Denver': ['Denver', 'Denver'],
  'America/Boise': ['Boise', 'Boise'],
  'America/Phoenix': ['Phoenix', 'Phoenix'],
  'America/Los_Angeles': ['Los Ángeles', 'Los Angeles'],
  'America/Anchorage': ['Anchorage', 'Anchorage'],
  'America/Juneau': ['Juneau', 'Juneau'],
  'America/Sitka': ['Sitka', 'Sitka'],
  'America/Metlakatla': ['Metlakatla', 'Metlakatla'],
  'America/Yakutat': ['Yakutat', 'Yakutat'],
  'America/Nome': ['Nome', 'Nome'],
  'America/Adak': ['Adak', 'Adak'],
  'Pacific/Honolulu': ['Honolulu', 'Honolulu'],
};

export function zoneLabel(zone: string, language: 'es' | 'en' = 'es'): string {
  return ZONE_LABELS[zone]?.[language === 'en' ? 1 : 0]
    ?? zone.slice(zone.lastIndexOf('/') + 1).replace(/_/g, ' ');
}
