//go:build windows

package winsys

import (
	"errors"

	"github.com/danieljoos/wincred"
)

const credTarget = "RLGoalTracker/apiKey"

// LoadKey returns the stored API key, or "" with a nil error when none is stored.
func LoadKey() (string, error) {
	c, err := wincred.GetGenericCredential(credTarget)
	if err != nil {
		if errors.Is(err, wincred.ErrElementNotFound) {
			return "", nil
		}
		return "", err
	}
	return string(c.CredentialBlob), nil
}

// SaveKey stores the API key in Windows Credential Manager.
func SaveKey(k string) error {
	c := wincred.NewGenericCredential(credTarget)
	c.CredentialBlob = []byte(k)
	c.Persist = wincred.PersistLocalMachine
	return c.Write()
}

// DeleteKey removes the stored key; a missing key is not an error.
func DeleteKey() error {
	c, err := wincred.GetGenericCredential(credTarget)
	if err != nil {
		if errors.Is(err, wincred.ErrElementNotFound) {
			return nil
		}
		return err
	}
	return c.Delete()
}
