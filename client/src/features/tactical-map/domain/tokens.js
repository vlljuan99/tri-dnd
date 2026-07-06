export function updateTokenPosition(map, tokenId, position) {
  return {
    ...map,
    tokens: map.tokens.map((token) => (token.id === tokenId ? { ...token, position: { ...position, y: 0 } } : token)),
  };
}
