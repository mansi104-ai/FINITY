declare namespace Express {
  interface Request {
    authUser?: {
      id: string;
      email: string;
    };
    auth?: {
      userId: string;
      email: string;
      sessionId: string;
      tokenVersion: number;
    };
  }
}
