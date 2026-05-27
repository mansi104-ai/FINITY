import type { Request, Response } from "express";
import { getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead } from "../store/db";

export async function getNotificationsController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const [notifications, unreadCount] = await Promise.all([
    getNotifications(userId, 20),
    getUnreadCount(userId)
  ]);
  return res.status(200).json({ notifications, unreadCount });
}

export async function markReadController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "id required" });
  await markNotificationRead(id, userId);
  return res.status(200).json({ ok: true });
}

export async function markAllReadController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  await markAllNotificationsRead(userId);
  return res.status(200).json({ ok: true });
}
