package state

import "fmt"

const (
	KeyPrefixSession = "session:"
	KeyPrefixRoom    = "room:"
	KeyPrefixPeer    = "peer:"

	SessionTTL = 30  // seconds after disconnect
	RoomTTL    = 300 // 5 minutes after empty
)

func SessionKey(sessionID string) string {
	return fmt.Sprintf("%s%s", KeyPrefixSession, sessionID)
}

func RoomMetaKey(roomID string) string {
	return fmt.Sprintf("%s%s:meta", KeyPrefixRoom, roomID)
}

func RoomPeersKey(roomID string) string {
	return fmt.Sprintf("%s%s:peers", KeyPrefixRoom, roomID)
}

func PeerTracksKey(peerID string) string {
	return fmt.Sprintf("%s%s:tracks", KeyPrefixPeer, peerID)
}
