export function canMoveToken({ token, user, role }) {
  if (!token || !token.visible || !user) return false;
  if (role === 'dm') return true;
  return token.ownerUserId === user.id;
}
