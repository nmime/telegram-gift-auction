/**
 * Language update request
 */
export interface ILanguageUpdate {
  /** Language code (en or ru) */
  language: "en" | "ru";
}

/**
 * Language update response
 */
export interface ILanguageResponse {
  /** Updated language code */
  languageCode: string;
}
