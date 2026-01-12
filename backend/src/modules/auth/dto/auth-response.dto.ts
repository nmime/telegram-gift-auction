/**
 * User data in auth responses
 */
export interface IUserResponse {
  /** User ID */
  id: string;

  /** Username */
  username: string;

  /** Available balance in Stars */
  balance: number;

  /** Balance frozen in active bids */
  frozenBalance: number;

  /** Telegram user ID (if authenticated via Telegram) */
  telegramId?: number;

  /** User first name (from Telegram) */
  firstName?: string;

  /** User last name (from Telegram) */
  lastName?: string;

  /** User photo URL (from Telegram) */
  photoUrl?: string;
}

/**
 * Login response with user data and access token
 */
export interface ILoginResponse {
  /** User data */
  user: IUserResponse;

  /** JWT access token */
  accessToken: string;
}

/**
 * Logout response
 */
export interface ILogoutResponse {
  /** Success status */
  success: boolean;
}
