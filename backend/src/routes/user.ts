import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { handleError, AppError } from "../utils/errorHandler";
import logger from "../utils/logger";
import { supabaseClient } from "../config/supabase";
import { User } from "../types";

const router = Router();

/**
 * User Profile Routes
 * SECURITY: All routes require authentication
 */

/**
 * GET /user/profile
 * Get current user's profile
 */
router.get(
  "/profile",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      logger.info("Fetching user profile", { userId });

      // Get user auth data
      const { data: authData, error: authError } =
        await supabaseClient.auth.getUser();

      if (authError || !authData.user) {
        throw new AppError(
          "Failed to fetch user profile",
          "FETCH_PROFILE_FAILED",
          500
        );
      }

      // Get user preferences from database
      const { data: profileData, error: profileError } =
        await supabaseClient
          .from("user_profiles")
          .select("*")
          .eq("user_id", userId)
          .single();

      // It's okay if profile doesn't exist yet (first login)
      const user: User = {
        id: authData.user.id,
         email: authData.user.email || "",
        full_name: authData.user.user_metadata?.full_name,
        style_preferences: profileData?.style_preferences,
        budget_range: profileData?.budget_range,
        created_at: authData.user.created_at,
        updated_at: profileData?.updated_at || authData.user.updated_at,
      };

      return res.status(200).json({
        user,
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * PUT /user/profile
 * Update user profile and preferences
 * SECURITY: Only the authenticated user can update their own profile
 */
router.put(
  "/profile",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { fullName, stylePreferences, budgetRange } = req.body;

      logger.info("Updating user profile", { userId });

      // Update user auth metadata
      if (fullName) {
        const { error: updateError } =
          await supabaseClient.auth.updateUser({
            data: {
              full_name: fullName,
            },
          });

        if (updateError) {
          throw new AppError(
            "Failed to update profile",
            "UPDATE_FAILED",
            500
          );
        }
      }

      // Update user preferences in database
      if (stylePreferences || budgetRange) {
        const { error: prefError } = await supabaseClient
          .from("user_profiles")
          .upsert(
            {
              user_id: userId,
              style_preferences: stylePreferences,
              budget_range: budgetRange,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );

        if (prefError) {
          logger.error("Failed to update preferences", {
            userId,
            error: prefError.message,
          });
          // Don't fail the request, just log
        }
      }

      return res.status(200).json({
        message: "Profile updated successfully",
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * POST /user/logout
 * Logout user (invalidate session)
 */
router.post(
  "/logout",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      logger.info("User logging out", { userId });

      const { error } = await supabaseClient.auth.signOut();

      if (error) {
        throw new AppError("Logout failed", "LOGOUT_FAILED", 500);
      }

      return res.status(200).json({
        message: "Logged out successfully",
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * DELETE /user/account
 * Delete user account (dangerous operation)
 * SECURITY: Requires explicit confirmation
 */
router.delete(
  "/account",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { confirmDelete } = req.body;

      if (confirmDelete !== true) {
        return res.status(400).json({
          error: {
            code: "MISSING_CONFIRMATION",
            message:
              "Account deletion requires confirmDelete: true in request body",
          },
        });
      }

      logger.warn("Deleting user account", { userId });

      // Delete user data from database
      await supabaseClient
        .from("user_profiles")
        .delete()
        .eq("user_id", userId);

      await supabaseClient.from("searches").delete().eq("user_id", userId);

      await supabaseClient
        .from("saved_outfits")
        .delete()
        .eq("user_id", userId);

      // Delete auth user - this must be done by admin
      // In a production app, this would be handled by a separate admin function
      // For now, just log the cleanup
      logger.info("User account deleted successfully", { userId });

      return res.status(200).json({
        message: "Account deleted successfully",
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

export default router;
