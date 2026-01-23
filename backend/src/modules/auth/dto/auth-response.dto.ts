export interface IUserResponse {
  id: string;
  username: string;
  balance: number;
  frozenBalance: number;
  telegramId?: number;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  languageCode?: string;
}

export interface ILoginResponse {
  user: IUserResponse;
  accessToken: string;
}

export interface ILogoutResponse {
  success: boolean;
}
