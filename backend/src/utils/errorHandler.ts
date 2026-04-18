import { Response } from "express";
import { ApiError } from "../types";
import logger from "./logger";

export class AppError extends Error implements ApiError {
  code: string;
  statusCode: number;
  details?: Record<string, any>;

  constructor(
    message: string,
    code: string = "INTERNAL_ERROR",
    statusCode: number = 500,
    details?: Record<string, any>
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const handleError = (err: Error | AppError, res: Response) => {
  if (err instanceof AppError) {
    logger.error(`[${err.code}] ${err.message}`, { details: err.details });
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  return res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
};

export const asyncHandler =
  (fn: Function) =>
  (...args: any[]) =>
    Promise.resolve(fn(...args)).catch(args[2]);
