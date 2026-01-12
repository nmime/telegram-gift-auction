/**
 * Login request DTO
 */
export interface ILogin {
  /**
   * Username for login or registration. New users are automatically created.
   * @minLength 3
   * @maxLength 30
   * @pattern ^[a-zA-Z0-9_]+$
   */
  username: string;
}
