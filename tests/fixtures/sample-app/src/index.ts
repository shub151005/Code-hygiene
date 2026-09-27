import { loginUser } from './services/auth.js';
import { add } from './services/math.js';

export function runMain() {
  console.log('App starting...');
  const sum = add(10, 20);
  const user = loginUser('alice', 'password123');
  return { sum, user };
}

runMain();
