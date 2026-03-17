declare namespace Express {
  interface Request {
    authUser?: {
      id: string;
      email: string;
    };
  }
}
