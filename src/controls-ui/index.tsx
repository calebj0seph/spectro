import React from 'react';
import ReactDOM from 'react-dom';

import { RenderParameters } from '../spectrogram-render';

import generateSettingsContainer from './SettingsContainer';

export default function initialiseControlsUi(
    container: Element,
    props: {
        stopCallback: () => void;
        clearSpectrogramCallback: () => void;
        renderParametersUpdateCallback: (settings: Partial<RenderParameters>) => void;
        renderFromMicrophoneCallback: () => void;
        renderFromFileCallback: (file: ArrayBuffer) => void;
    }
) {
    const [SettingsContainer, setPlayState] = generateSettingsContainer();

    ReactDOM.render(
        <SettingsContainer
            onStop={props.stopCallback}
            onClearSpectrogram={props.clearSpectrogramCallback}
            onRenderParametersUpdate={props.renderParametersUpdateCallback}
            onRenderFromMicrophone={props.renderFromMicrophoneCallback}
            onRenderFromFile={props.renderFromFileCallback}
        />,
        container
    );

    return setPlayState;
}
