//go:build integration

package cluster

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	channelruntime "github.com/WuKongIM/WuKongIM/pkg/channel"
	"github.com/WuKongIM/WuKongIM/pkg/dataformat"
	"github.com/stretchr/testify/require"
)

// TestDataFormatSingleNodeClusterReopen preserves history and sequence allocation
// across a creator change, including a fixture without historical registration.
func TestDataFormatSingleNodeClusterReopen(t *testing.T) {
	for _, registered := range []bool{true, false} {
		name := "registered"
		if !registered {
			name = "unregistered"
		}
		t.Run(name, func(t *testing.T) {
			cfg := Config{NodeID: 1, ListenAddr: freeTCPAddr(t), DataDir: t.TempDir(),
				Control: ControlConfig{ClusterID: "format-reopen"},
				Slots:   SlotConfig{InitialSlotCount: 12, HashSlotCount: 256, ReplicaCount: 1},
				// Report the restarted node within the bounded readiness budget.
				HealthReport: HealthReportConfig{Interval: 100 * time.Millisecond},
				CreatedBy:    dataformat.Build{Program: "wukongim", Version: "creator"}}
			node, err := New(cfg)
			require.NoError(t, err)
			t.Cleanup(func() { stopNodes(t, node) })
			startNode(t, node)
			waitNodeWriteReady(t, node)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			channel := channelruntime.ChannelID{ID: "format-history", Type: 2}
			first, err := node.AppendChannel(ctx, channelruntime.AppendRequest{ChannelID: channel,
				CommitMode: channelruntime.CommitModeQuorum,
				Message:    channelruntime.Message{MessageID: 1001, Payload: []byte("before-reopen")}})
			require.NoError(t, err)
			stopNodes(t, node)
			markerPath := filepath.Join(cfg.DataDir, dataformat.FileName)
			marker, err := os.ReadFile(markerPath)
			require.NoError(t, err)
			if !registered {
				// Model a pre-registration directory without changing its database files.
				require.NoError(t, os.Remove(markerPath))
			}
			cfg.CreatedBy.Version = "upgraded-server"
			node, err = New(cfg)
			require.NoError(t, err)
			startNode(t, node)
			waitNodeWriteReady(t, node)
			requireChannelMessage(t, node, channel, first.MessageSeq, 1001, []byte("before-reopen"))
			second, err := node.AppendChannel(ctx, channelruntime.AppendRequest{ChannelID: channel,
				CommitMode: channelruntime.CommitModeQuorum,
				Message:    channelruntime.Message{MessageID: 1002, Payload: []byte("after-reopen")}})
			require.NoError(t, err)
			require.Equal(t, first.MessageSeq+1, second.MessageSeq)
			if registered {
				after, err := os.ReadFile(markerPath)
				require.NoError(t, err)
				require.Equal(t, marker, after)
			} else {
				require.NoFileExists(t, markerPath)
			}
		})
	}
}
