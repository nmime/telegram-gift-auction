/**
 * Telegram Login Widget authentication data
 */
export interface ITelegramWidgetAuth {
  /** Telegram user ID */
  id: number;

  /** User first name */
  first_name: string;

  /** User last name */
  last_name?: string;

  /** Telegram username */
  username?: string;

  /** User photo URL */
  photo_url?: string;

  /** User language code */
  language_code?: string;

  /** Is premium user */
  is_premium?: boolean;

  /** Authentication timestamp */
  auth_date: number;

  /** Data hash for validation */
  hash: string;
}

/**
 * Telegram Web App user data
 */
export interface IWebAppUser {
  /** Telegram user ID */
  id: number;

  /** User first name */
  first_name: string;

  /** User last name */
  last_name?: string;

  /** Telegram username */
  username?: string;

  /** User language code */
  language_code?: string;

  /** Is premium user */
  is_premium?: boolean;

  /** User photo URL */
  photo_url?: string;
}

/**
 * Telegram Mini App authentication data
 */
export interface ITelegramWebAppAuth {
  /**
   * Raw initData string from Telegram.WebApp.initData
   */
  initData: string;
}
