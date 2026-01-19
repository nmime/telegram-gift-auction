import type {
  User,
  Auction,
  Bid,
  LeaderboardResponse,
  Transaction,
  CreateAuctionData,
  BalanceInfo,
  PlaceBidResponse,
  MinWinningBidResponse,
  LoginResponse,
  ApiError,
  TelegramWidgetUser,
} from '../types';

const apiBase = import.meta.env.VITE_API_URL;
const tokenKey = 'auth_token';

let accessToken: string | null = localStorage.getItem(tokenKey);

type AuthEventCallback = () => void;
let onUnauthorizedCallback: AuthEventCallback | null = null;

export function setOnUnauthorized(callback: AuthEventCallback | null) {
  onUnauthorizedCallback = callback;
}

export function setToken(token: string | null) {
  accessToken = token;
  if (token) {
    localStorage.setItem(tokenKey, token);
  } else {
    localStorage.removeItem(tokenKey);
  }
}

export function getToken(): string | null {
  return accessToken;
}

export function clearToken() {
  accessToken = null;
  localStorage.removeItem(tokenKey);
}

export class ApiRequestError extends Error {
  public readonly statusCode: number;
  public readonly error?: string;

  constructor(apiError: ApiError, statusCode: number) {
    super(apiError.message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.error = apiError.error;
  }
}

interface FetchOptions extends RequestInit {
  skipAuthCheck?: boolean;
}

async function fetchApi<T>(url: string, options?: FetchOptions): Promise<T> {
  const { skipAuthCheck, ...fetchOptions } = options || {};

  const headers: Record<string, string> = {
    ...(fetchOptions?.headers as Record<string, string>),
  };

  // Only set Content-Type for requests with a body
  if (fetchOptions?.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${apiBase}${url}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch((): ApiError => ({
      message: 'Request failed',
    }));

    if (response.status === 401 && !skipAuthCheck) {
      clearToken();
      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
    }

    throw new ApiRequestError(errorData as ApiError, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function login(username: string): Promise<LoginResponse> {
  const response = await fetchApi<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username }),
    skipAuthCheck: true,
  });
  setToken(response.accessToken);
  return response;
}

export async function loginWithTelegramWidget(user: TelegramWidgetUser): Promise<LoginResponse> {
  const response = await fetchApi<LoginResponse>('/auth/telegram/widget', {
    method: 'POST',
    body: JSON.stringify(user),
    skipAuthCheck: true,
  });
  setToken(response.accessToken);
  return response;
}

export async function loginWithTelegramMiniApp(initData: string): Promise<LoginResponse> {
  const response = await fetchApi<LoginResponse>('/auth/telegram/webapp', {
    method: 'POST',
    body: JSON.stringify({ initData }),
    skipAuthCheck: true,
  });
  setToken(response.accessToken);
  return response;
}

export async function logout(): Promise<void> {
  try {
    await fetchApi<void>('/auth/logout', { method: 'POST' });
  } finally {
    clearToken();
  }
}

export async function getMe(): Promise<User | null> {
  if (!accessToken) {
    return null;
  }
  try {
    return await fetchApi<User>('/auth/me', { skipAuthCheck: true });
  } catch (error) {
    if (error instanceof ApiRequestError && error.statusCode === 401) {
      clearToken();
      return null;
    }
    throw error;
  }
}

export async function getBalance(): Promise<BalanceInfo> {
  return fetchApi<BalanceInfo>('/users/balance');
}

export async function deposit(amount: number): Promise<BalanceInfo> {
  return fetchApi<BalanceInfo>('/users/deposit', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

export async function withdraw(amount: number): Promise<BalanceInfo> {
  return fetchApi<BalanceInfo>('/users/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

export async function getTransactions(
  limit: number = 50,
  offset: number = 0
): Promise<Transaction[]> {
  return fetchApi<Transaction[]>(`/transactions?limit=${limit}&offset=${offset}`);
}

export async function getAuctions(status?: string): Promise<Auction[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return fetchApi<Auction[]>(`/auctions${query}`);
}

export async function getAuction(id: string): Promise<Auction> {
  return fetchApi<Auction>(`/auctions/${encodeURIComponent(id)}`);
}

export async function createAuction(data: CreateAuctionData): Promise<Auction> {
  return fetchApi<Auction>('/auctions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function startAuction(id: string): Promise<Auction> {
  return fetchApi<Auction>(`/auctions/${encodeURIComponent(id)}/start`, {
    method: 'POST',
  });
}

export async function placeBid(
  auctionId: string,
  amount: number
): Promise<PlaceBidResponse> {
  return fetchApi<PlaceBidResponse>(
    `/auctions/${encodeURIComponent(auctionId)}/bid`,
    {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }
  );
}

export async function getLeaderboard(
  auctionId: string,
  limit?: number,
  offset?: number,
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const query = params.toString();
  return fetchApi<LeaderboardResponse>(
    `/auctions/${encodeURIComponent(auctionId)}/leaderboard${query ? `?${query}` : ''}`
  );
}

export async function getMyBids(auctionId: string): Promise<Bid[]> {
  return fetchApi<Bid[]>(`/auctions/${encodeURIComponent(auctionId)}/my-bids`);
}

export async function getMinWinningBid(
  auctionId: string
): Promise<MinWinningBidResponse> {
  return fetchApi<MinWinningBidResponse>(
    `/auctions/${encodeURIComponent(auctionId)}/min-winning-bid`
  );
}

export interface FinancialAuditResult {
  isValid: boolean;
  totalBalance: number;
  totalFrozen: number;
  totalWinnings: number;
  discrepancy: number;
  details: string;
}

export async function getFinancialAudit(): Promise<FinancialAuditResult> {
  return fetchApi<FinancialAuditResult>('/auctions/system/audit');
}

export interface LanguageResponse {
  languageCode: string;
}

export async function updateLanguage(language: string): Promise<LanguageResponse> {
  return fetchApi<LanguageResponse>('/users/language', {
    method: 'PUT',
    body: JSON.stringify({ language }),
  });
}
