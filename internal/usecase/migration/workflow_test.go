package migration

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReadPlanDefaultRevisionPreservesLegacyIdentity(t *testing.T) {
	const revision = "a888f89533d0e7d1b2030e06504ca97f1ad891d4"
	legacy := Plan{Version: 1, SourceCommit: revision, Sources: []NodeOptions{{NodeID: 1, Options: Options{DataDir: filepath.Join(t.TempDir(), "source"), ShardCount: 2}}}}
	encoded, err := json.Marshal(legacy)
	require.NoError(t, err)
	var fields map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(encoded, &fields))
	for _, name := range []string{"explicit", "omitted", "empty", "null"} {
		t.Run(name, func(t *testing.T) {
			switch name {
			case "omitted":
				delete(fields, "source_commit")
			case "empty":
				fields["source_commit"] = json.RawMessage(`""`)
			case "null":
				fields["source_commit"] = json.RawMessage(`null`)
			}
			data, err := json.Marshal(fields)
			require.NoError(t, err)
			plan, err := ReadPlan(bytes.NewReader(data), revision)
			require.NoError(t, err)
			require.Equal(t, legacy, plan)
			// Existing workspace and archive seals must remain reusable.
			require.Equal(t, legacy.Digest(), plan.Digest())
		})
	}
	for _, value := range []json.RawMessage{json.RawMessage(`"different-revision"`), json.RawMessage(`" "`), json.RawMessage(`42`)} {
		fields["source_commit"] = value
		data, err := json.Marshal(fields)
		require.NoError(t, err)
		_, err = ReadPlan(bytes.NewReader(data), revision)
		require.Error(t, err)
	}
}
