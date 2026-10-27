export const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
