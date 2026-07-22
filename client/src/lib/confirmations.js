export function matchesRequiredText(value, requiredText) {
  return requiredText === undefined || value === requiredText;
}

export function connectedPlayerCount(online, dmUserId) {
  return (online ?? []).filter((member) => Number(member.id) !== Number(dmUserId)).length;
}

export function mapActivationContext({ isLive, online, dmUserId }) {
  const playerCount = connectedPlayerCount(online, dmUserId);
  return {
    isLive: Boolean(isLive),
    playerCount,
    requiresConfirmation: playerCount > 0,
  };
}
