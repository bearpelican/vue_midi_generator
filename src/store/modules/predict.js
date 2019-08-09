import $backend from '@/backend'
import { storeToMidi } from '@/lib/convert'
import { PredictionType, predictionTypeForName } from '@/lib/config'
import _ from 'lodash'

export const state = {
  songs: [],
  sid: null,
  nSteps: 200,
  seedLen: 10,
  durationTemp: 0.5,
  noteTemp: 1.2,
  midiXML: null,
  tutorialStep: 10,
  loadingState: null,
  predictionType: PredictionType.next
}

export const mutations = {
  updateSID (state, sid) {
    state.sid = sid
  },
  updateTutorialStep (state, step) {
    if (state.tutorialStep < step) {
      // state.tutorialStep = step
    }
  },
  updateSongs (state, songs) {
    state.songs = songs
  },
  updateSteps (state, steps) {
    state.nSteps = steps
  },
  updateSeedLen (state, seedLen) {
    state.seedLen = seedLen
  },
  updatePredictionType (state, predictionType) {
    state.predictionType = predictionType
    state.noteTemp = predictionType.temp[0]
    state.durationTemp = predictionType.temp[1]
  },
  updateNoteTemp (state, noteTemp) {
    state.noteTemp = noteTemp
  },
  updateDurationTemp (state, durationTemp) {
    state.durationTemp = durationTemp
  },
  updateMidiXML (state, xml) {
    state.midiXML = xml
  },
  fromSave (state, savedState) {
    state.predictionType = predictionTypeForName(savedState.predictionType, state.predictionType)
    delete savedState.predictionType

    // Left merge values
    for (const key in state) {
      if (_.has(savedState, key)) {
        state[key] = savedState[key]
      }
    }
    // state.seedLen = seedLen ? state.seedLen
    // state.durationTemp = durationTemp ? state.durationTemp
    // state.noteTemp = noteTemp ? state.noteTemp
  },
  updateLoadingState (state, loadingState) {
    state.loadingState = loadingState
    console.log('Updating loading state:', loadingState)
  },
  showError (state, error, timeout = 2000) {
    state.loadingState = error
    console.log('Updating with error:', error)
    setTimeout(() => {
      state.loadingState = null
    }, timeout)
  }
}

export const actions = {
  async fetchSongs ({ commit }) {
    $backend.fetchSongs().then(result => {
      commit('updateSongs', result)
    })
  },
  async predictMidi ({ commit, rootState }) {
    commit('updateLoadingState', 'Making music...')
    commit('updateTutorialStep', 2)

    let { nSteps, seedLen, durationTemp, noteTemp, predictionType, sid: originalSID } = rootState.predict
    // const track = predictionType.track
    // Filtering seedLen serverside for now.
    // if (['pitch', 'rhythm'].includes(predictionType.name)) {
    //   seedLen = null
    // }
    const { midi, bpm, seqName } = storeToMidi(rootState.sequence)

    // Progress
    let counter = -10
    let progress = setInterval(() => {
      if (counter > 0) {
        commit('updateLoadingState', `Generating steps (${counter} / ${nSteps})...`)
      }
      counter += 1
    }, 1000 * 0.25)

    setTimeout(() => {
      if (progress != null) {
        clearInterval(progress)
        commit('showError', `Error: Timeout trying to generate sequence...`)
      }
    }, 1000 * 0.25 * nSteps)

    let error = null
    let s3id = null
    // Predictions
    try {
      ({ result: s3id, error } = await $backend.predictMidi({ midi, nSteps, bpm, seqName, seedLen, durationTemp, noteTemp, predictionType: predictionType.name, originalSID }))
    } catch (e) {
      error = e
    }
    if (error) {
      clearInterval(progress)
      commit('showError', `Error: ${error}`)
      return null
    }

    clearInterval(progress)
    progress = null

    return s3id
  },
  async convertToXML ({ commit, rootState }) {
    const { midi } = storeToMidi(rootState.sequence, null)

    let result = await $backend.convertToXML({ midi })
    console.log('Result returned from convertToXML:', result)
    commit('updateMidiXML', result)
    return result
  },
  async loadOrig ({ commit, dispatch }, sid) {
    // Load original notes, so user can play both
    const midiBuffer = await $backend.fetchMidi(sid, 'song')
    commit('updateSID', sid)
    await dispatch('sequence/loadOrigBuffer', { midiBuffer }, { root: true })
  },
  async loadSong ({ commit, dispatch }, sid) {
    commit('updateLoadingState', 'Loading song...')
    commit('updateSID', sid)

    commit('sequence/updateOrigNotes', { notes: [] }, { root: true })
    const { midiBuffer, store } = await $backend.loadState(sid, 'song')
    commit('fromSave', store)
    const { display: seqName } = store
    await dispatch('sequence/loadMidiBuffer', { midiBuffer, seqName, savePrevious: false }, { root: true })
    commit('updateLoadingState', null)
  },
  async loadPrediction ({ commit, dispatch }, pid) {
    commit('updateLoadingState', 'Loading prediction...')
    const { midiBuffer, store } = await $backend.loadState(pid, 'predict')
    commit('fromSave', store)

    const { seqName, originalSID } = store
    // Load Original Song
    if (originalSID) dispatch('loadOrig', originalSID)

    await dispatch('sequence/loadMidiBuffer', { midiBuffer, seqName, savePrevious: false }, { root: true })
    commit('updateLoadingState', null)
  }
}

export default {
  namespaced: true,
  state,
  mutations,
  actions
}
