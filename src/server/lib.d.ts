import type { JSX as JSX2 } from 'hono/jsx/jsx-dev-runtime';

declare global {
    namespace JSX {
        interface IntrinsicElements extends JSX2.IntrinsicElements {
        }
    }
}
