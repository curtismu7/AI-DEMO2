/**
 * Configure jest.mock('axios') so axios.create() returns an instance with:
 * - interceptors.request/response.use (BankingAPIClient)
 * - post / get / request (TokenIntrospector and API client calls)
 *
 * Call at the very start of beforeAll, before any BankingAPIClient,
 * BankingAuthenticationManager, or other code that invokes axios.create().
 *
 * Parameter is jest.Mocked<typeof axios>; typed as any because Jest's Mock types
 * do not structurally match plain jest.Mock.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupIntegrationAxiosMock(mockedAxios: any): void {
  mockedAxios.interceptors = {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  };
  mockedAxios.request = jest.fn();
  mockedAxios.post = jest.fn();
  mockedAxios.get = jest.fn();
  mockedAxios.defaults = { headers: {} };
  mockedAxios.create.mockReturnValue(mockedAxios);
}

/**
 * Rejection value that axios.isAxiosError recognizes, with a fully-shaped `response`
 * so BankingAPIClient response interceptors and mapError never read undefined `.data`.
 */
export function mockAxiosHttpError(
  status: number,
  data: Record<string, unknown>,
): Error & { isAxiosError: boolean; response: { status: number; data: typeof data } } {
  const e = new Error(`Request failed with status ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number; data: typeof data };
  };
  e.isAxiosError = true;
  e.response = { status, data };
  return e;
}
