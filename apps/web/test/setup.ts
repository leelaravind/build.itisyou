import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React Testing Library does not auto-clean when `globals: false`. Without this, a component from
// one test stays mounted into the next, and queries silently match the wrong instance.
afterEach(cleanup);
