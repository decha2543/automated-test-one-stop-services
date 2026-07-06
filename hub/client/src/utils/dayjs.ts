import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import relativeTime from 'dayjs/plugin/relativeTime';

/**
 * Centralised dayjs plugin registration.
 *
 * Importing this module from `main.tsx` extends dayjs once so every component
 * can use `dayjs(...).fromNow()` and custom format parsing without each file
 * re-running `dayjs.extend(...)`.
 */
dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);

export { dayjs };
