// Package migration owns the offline v2-to-v3 migration workflow and its
// immutable source, authority, archive and target completion contracts.
package migration

import "context"

type Kind uint8

const (
	Primary        Kind = 1
	Index          Kind = 2
	SecondaryIndex Kind = 3
	Other          Kind = 4
)

// Row owns its bytes; a visitor may retain it after Scan advances. Fields are
// complete primary columns. Non-column rows and indexes retain exact Key/Value.
type Row struct {
	Shard  int               `json:"shard"`
	Table  string            `json:"table"`
	Kind   Kind              `json:"kind"`
	Owner  uint64            `json:"owner,omitempty"`
	ID     uint64            `json:"id,omitempty"`
	Key    []byte            `json:"key"`
	Value  []byte            `json:"value,omitempty"`
	Fields map[string][]byte `json:"fields,omitempty"`
}

// Options requires the actual source shard count, never a guessed default.
type Options struct {
	DataDir    string `json:"data_dir"`
	ShardCount int    `json:"shard_count"`
	// MaxRowBytes bounds a complete logical row, including keys and columns.
	// Zero selects 64 MiB; larger source records require an explicit bound.
	MaxRowBytes int `json:"max_row_bytes,omitempty"`
}

// NodeOptions binds a stopped directory to an explicitly supplied node identity.
// NodeID comes from deployment configuration, not an inferred binary version.
type NodeOptions struct {
	Options
	NodeID uint64 `json:"node_id"`
}

// SourceConfig is the original Config JSON persisted by the fixed v2 server.
// It describes source ownership only; it must never become v3 cluster state.
type SourceConfig struct {
	Version             uint64       `json:"version"`
	SlotCount           uint32       `json:"slotCount"`
	SlotReplicaCount    uint32       `json:"slotReplicaCount"`
	ChannelReplicaCount uint32       `json:"channelReplicaCount"`
	Term                uint32       `json:"term"`
	MigrateFrom         uint64       `json:"migrateFrom,omitempty"`
	MigrateTo           uint64       `json:"migrateTo,omitempty"`
	Learners            []uint64     `json:"learners,omitempty"`
	Nodes               []SourceNode `json:"nodes"`
	Slots               []SourceSlot `json:"slots"`
}

type SourceNode struct {
	ID            uint64 `json:"id"`
	ClusterAddr   string `json:"clusterAddr,omitempty"`
	APIServerAddr string `json:"apiServerAddr,omitempty"`
	Join          bool   `json:"join,omitempty"`
	Online        bool   `json:"online,omitempty"`
	OfflineCount  uint32 `json:"offlineCount,omitempty"`
	LastOffline   int64  `json:"lastOffline,omitempty"`
	AllowVote     bool   `json:"allowVote,omitempty"`
	Role          int32  `json:"role,omitempty"`
	Status        int32  `json:"status,omitempty"`
	CreatedAt     int64  `json:"createdAt,omitempty"`
}

type SourceSlot struct {
	ID           uint32   `json:"id"`
	Leader       uint64   `json:"leader"`
	Term         uint32   `json:"term"`
	Replicas     []uint64 `json:"replicas"`
	Learners     []uint64 `json:"learners,omitempty"`
	MigrateFrom  uint64   `json:"migrateFrom,omitempty"`
	MigrateTo    uint64   `json:"migrateTo,omitempty"`
	ExpectLeader uint64   `json:"expectLeader,omitempty"`
	Status       int32    `json:"status,omitempty"`
}

// SourceFile identifies exact immutable bytes, relative to one source directory.
// LOCK entries retain size and identity but are never reopened while locked:
// POSIX closes could release the source exclusion held by this process.
type SourceFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256,omitempty"`
}

// NodeSnapshot is published only after a complete locked scan and a second
// matching file digest. It makes no claim about historical ACKs or notifications
// already dequeued into the old process before shutdown.
type NodeSnapshot struct {
	SlotProgress                []LogProgress `json:"slot_progress"`
	ConfigProgress              LogProgress   `json:"config_progress"`
	NodeID                      uint64        `json:"node_id"`
	Config                      SourceConfig  `json:"config"`
	SlotShardCount              int           `json:"slot_shard_count"`
	NotificationDepth           int64         `json:"notification_depth"`
	NotificationMetadataPresent bool          `json:"notification_metadata_present"`
	DataDigest                  string        `json:"data_digest"`
	FileCount                   uint64        `json:"file_count"`
	FileBytes                   uint64        `json:"file_bytes"`
	RowCount                    uint64        `json:"row_count"`
}

// LogProgress describes persisted original logs, not a historical quorum proof.
// Record digests exclude per-replica append timestamps and include the original
// ID, index, term and command bytes. Applied and last indexes remain distinct.
type LogProgress struct {
	Group        string `json:"group"`
	FirstIndex   uint64 `json:"first_index"`
	LastIndex    uint64 `json:"last_index"`
	LastTerm     uint32 `json:"last_term"`
	AppliedIndex uint64 `json:"applied_index"`
	LastDigest   string `json:"last_digest,omitempty"`
	LogDigest    string `json:"log_digest"`
}

// Source reads original stopped storage without modifying deployed v2 code.
// Returned rows are owned, bounded records; no node is implicitly authoritative.
type Source interface {
	ReadStoppedNode(context.Context, NodeOptions, func(Row) error, func(SourceFile) error) (NodeSnapshot, error)
}
