import lodash from 'lodash';

// Private dead function: declared but never called
function formatSecretToken(rawToken: string): string {
  return `Bearer-${rawToken.toUpperCase()}`;
}

export function loginUser(username: string, pass: string) {
  // Uses lodash
  const sanitized = lodash.escape(username);
  return {
    username: sanitized,
    authenticated: true,
  };
}
