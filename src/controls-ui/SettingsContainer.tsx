import Button from '@material-ui/core/Button';
import CircularProgress from '@material-ui/core/CircularProgress';
import Divider from '@material-ui/core/Divider';
import FormControl from '@material-ui/core/FormControl';
import InputLabel from '@material-ui/core/InputLabel';
import MenuItem from '@material-ui/core/MenuItem';
import ScopedCssBaseline from '@material-ui/core/ScopedCssBaseline';
import Select from '@material-ui/core/Select';
import pink from '@material-ui/core/colors/pink';
import { ThemeProvider, createMuiTheme, makeStyles } from '@material-ui/core/styles';
import AudiotrackIcon from '@material-ui/icons/Audiotrack';
import ClearIcon from '@material-ui/icons/Clear';
import MicIcon from '@material-ui/icons/Mic';
import StopIcon from '@material-ui/icons/Stop';
import clsx from 'clsx';
import React, { ChangeEvent, useState, useEffect, useMemo, useRef, useCallback } from 'react';

import { GRADIENTS } from '../color-util';
import { hzToMel, melToHz } from '../math-util';
import { Scale } from '../spectrogram';
import { RenderParameters } from '../spectrogram-render';

import generateLabelledSlider from './LabelledSlider';

const controlsTheme = createMuiTheme({
    palette: {
        type: 'dark',
        background: {
            default: '#101010',
            paper: '#222222'
        },
        primary: {
            main: '#ffffff'
        },
        secondary: pink
    }
});

const useStyles = makeStyles(theme => ({
    select: {
        width: '100%',
        marginBottom: theme.spacing(2)
    },
    sliderLabelContainer: {
        display: 'flex',
        justifyContent: 'space-between'
    },
    divider: {
        marginBottom: theme.spacing(2)
    },
    buttonContainer: {
        position: 'relative',
        marginBottom: theme.spacing(1)
    },
    buttonProgress: {
        color: pink[500],
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginTop: -12,
        marginLeft: -12
    },
    button: {
        width: '100%'
    },
    lastButton: {
        marginBottom: theme.spacing(2)
    }
}));

const formatHz = (hz: number) => {
    if (hz < 1000) {
        return `${hz.toPrecision(3)} Hz`;
    }
    return `${(hz / 1000).toPrecision(3)} kHz`;
};

const formatPercentage = (value: number) => `${(value * 100).toPrecision(3)}%`;

export type PlayState = 'stopped' | 'loading-file' | 'loading-mic' | 'playing';

export interface SettingsContainerProps {
    onStop: () => void;
    onClearSpectrogram: () => void;
    onRenderParametersUpdate: (settings: Partial<RenderParameters>) => void;
    onRenderFromMicrophone: () => void;
    onRenderFromFile: (file: ArrayBuffer) => void;
}

export type SettingsContainer = (props: SettingsContainerProps) => JSX.Element;

function generateSettingsContainer(): [SettingsContainer, (playState: PlayState) => void] {
    let setPlayStateExport: ((playState: PlayState) => void) | null = null;

    const SettingsContainer = ({
        onStop,
        onClearSpectrogram,
        onRenderParametersUpdate,
        onRenderFromMicrophone,
        onRenderFromFile
    }: SettingsContainerProps) => {
        const defaultParameters = {
            sensitivity: 0.5,
            contrast: 0.5,
            zoom: 4,
            minFrequency: 10,
            maxFrequency: 12000,
            scale: 'mel' as Scale,
            gradient: 'Heated Metal'
        };

        const classes = useStyles();

        const fileRef = useRef<HTMLInputElement | null>(null);

        const [playState, setPlayState] = useState<PlayState>('stopped');
        const [SensitivitySlider, setSensitivity] = useMemo(generateLabelledSlider, []);
        const [ContrastSlider, setContrast] = useMemo(generateLabelledSlider, []);
        const [ZoomSlider, setZoom] = useMemo(generateLabelledSlider, []);
        const [MinFrequencySlider, setMinFrequency] = useMemo(generateLabelledSlider, []);
        const [MaxFrequencySlider, setMaxFrequency] = useMemo(generateLabelledSlider, []);

        const onPlayMicrophoneClick = useCallback(() => {
            setPlayState('loading-mic');
            onRenderFromMicrophone();
        }, [onRenderFromMicrophone, setPlayState]);
        const onPlayFileClick = useCallback(() => {
            if (fileRef.current === null) {
                return;
            }
            fileRef.current.click();
        }, [fileRef]);
        const onFileChange = useCallback(() => {
            if (
                fileRef.current === null ||
                fileRef.current.files === null ||
                fileRef.current.files.length !== 1
            ) {
                return;
            }

            const file = fileRef.current.files[0];
            const reader = new FileReader();
            setPlayState('loading-file');
            reader.addEventListener('load', () => {
                if (fileRef.current !== null) {
                    fileRef.current.value = '';
                }

                if (reader.result instanceof ArrayBuffer) {
                    onRenderFromFile(reader.result);
                } else {
                    setPlayState('stopped');
                }
            });
            reader.readAsArrayBuffer(file);
        }, [fileRef, setPlayState, onRenderFromFile]);
        const onStopClick = useCallback(() => {
            onStop();
            setPlayState('stopped');
        }, [setPlayState]);
        const onSensitivityChange = useCallback(
            (value: number) => {
                const scaledValue = 10 ** (value * 3) - 1;
                onRenderParametersUpdate({ sensitivity: scaledValue });
                setSensitivity(formatPercentage(value));
            },
            [onRenderParametersUpdate, setSensitivity]
        );
        const onContrastChange = useCallback(
            (value: number) => {
                const scaledValue = 10 ** (value * 6) - 1;
                onRenderParametersUpdate({ contrast: scaledValue });
                setContrast(formatPercentage(value));
            },
            [onRenderParametersUpdate, setSensitivity]
        );
        const onZoomChange = useCallback(
            (value: number) => {
                onRenderParametersUpdate({ zoom: value });
                setZoom(formatPercentage(value));
            },
            [onRenderParametersUpdate, setSensitivity]
        );
        const onMinFreqChange = useCallback(
            (value: number) => {
                const hz = melToHz(value);
                onRenderParametersUpdate({ minFrequencyHz: hz });
                setMinFrequency(formatHz(hz));
            },
            [onRenderParametersUpdate, setSensitivity]
        );
        const onMaxFreqChange = useCallback(
            (value: number) => {
                const hz = melToHz(value);
                onRenderParametersUpdate({ maxFrequencyHz: hz });
                setMaxFrequency(formatHz(hz));
            },
            [onRenderParametersUpdate, setSensitivity]
        );
        const onScaleChange = useCallback(
            (event: ChangeEvent<{ name?: string | undefined; value: unknown }>) => {
                if (typeof event.target.value === 'string') {
                    onRenderParametersUpdate({ scale: event.target.value as Scale });
                }
            },
            [onRenderParametersUpdate]
        );
        const onGradientChange = useCallback(
            (event: ChangeEvent<{ name?: string | undefined; value: unknown }>) => {
                if (typeof event.target.value === 'string') {
                    const gradientData = GRADIENTS.find(g => g.name === event.target.value);
                    if (gradientData !== undefined) {
                        onRenderParametersUpdate({ gradient: gradientData.gradient });
                    }
                }
            },
            [onRenderParametersUpdate]
        );

        // Update all parameters on mount
        useEffect(() => {
            onSensitivityChange(defaultParameters.sensitivity);
            onContrastChange(defaultParameters.contrast);
            onZoomChange(defaultParameters.zoom);
            onMinFreqChange(hzToMel(defaultParameters.minFrequency));
            onMaxFreqChange(hzToMel(defaultParameters.maxFrequency));
            onRenderParametersUpdate({ scale: defaultParameters.scale });

            const gradientData = GRADIENTS.find(g => g.name === defaultParameters.gradient);
            if (gradientData !== undefined) {
                onRenderParametersUpdate({ gradient: gradientData.gradient });
            }
        }, []);

        useEffect(() => {
            setPlayStateExport = setPlayState;
        }, [setPlayState]);

        return (
            <ThemeProvider theme={controlsTheme}>
                <ScopedCssBaseline>
                    <>
                        <div className={classes.buttonContainer}>
                            <Button
                                className={classes.button}
                                variant="contained"
                                color="primary"
                                onClick={onPlayMicrophoneClick}
                                startIcon={<MicIcon />}
                                disabled={playState !== 'stopped'}
                            >
                                Record from mic
                            </Button>
                            {playState === 'loading-mic' && (
                                <CircularProgress size={24} className={classes.buttonProgress} />
                            )}
                        </div>
                        <input
                            type="file"
                            style={{ display: 'none' }}
                            accept="audio/*"
                            onChange={onFileChange}
                            ref={fileRef}
                        />
                        <div className={classes.buttonContainer}>
                            <Button
                                className={classes.button}
                                variant="contained"
                                color="primary"
                                onClick={onPlayFileClick}
                                startIcon={<AudiotrackIcon />}
                                disabled={playState !== 'stopped'}
                            >
                                Play audio file
                            </Button>
                            {playState === 'loading-file' && (
                                <CircularProgress size={24} className={classes.buttonProgress} />
                            )}
                        </div>

                        <Button
                            className={clsx(classes.button, classes.lastButton)}
                            variant="outlined"
                            color="secondary"
                            onClick={onStopClick}
                            startIcon={<StopIcon />}
                            disabled={playState !== 'playing'}
                        >
                            Stop
                        </Button>

                        <Divider className={classes.divider} />

                        <SensitivitySlider
                            nameLabelId="sensitivity-slider-label"
                            nameLabel="Sensitivity"
                            min={0}
                            max={1}
                            step={0.001}
                            defaultValue={defaultParameters.sensitivity}
                            onChange={onSensitivityChange}
                        />
                        <ContrastSlider
                            nameLabelId="contrast-slider-label"
                            nameLabel="Contrast"
                            min={0}
                            max={1}
                            step={0.001}
                            defaultValue={defaultParameters.contrast}
                            onChange={onContrastChange}
                        />
                        <ZoomSlider
                            nameLabelId="zoom-slider-label"
                            nameLabel="Zoom"
                            min={1}
                            max={10}
                            step={0.01}
                            defaultValue={defaultParameters.zoom}
                            onChange={onZoomChange}
                        />
                        <MinFrequencySlider
                            nameLabelId="min-freq-slider-label"
                            nameLabel="Min. frequency"
                            min={hzToMel(0)}
                            max={hzToMel(20000)}
                            step={1}
                            defaultValue={hzToMel(defaultParameters.minFrequency)}
                            onChange={onMinFreqChange}
                        />
                        <MaxFrequencySlider
                            nameLabelId="max-freq-slider-label"
                            nameLabel="Max. frequency"
                            min={hzToMel(0)}
                            max={hzToMel(20000)}
                            step={1}
                            defaultValue={hzToMel(defaultParameters.maxFrequency)}
                            onChange={onMaxFreqChange}
                        />
                        <FormControl className={classes.select}>
                            <InputLabel id="scale-select-label">Frequency scale</InputLabel>
                            <Select
                                labelId="scale-select-label"
                                id="scale-select"
                                defaultValue={defaultParameters.scale}
                                onChange={onScaleChange}
                            >
                                <MenuItem value="mel">Mel</MenuItem>
                                <MenuItem value="linear">Linear</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl className={classes.select}>
                            <InputLabel id="gradient-select-label">Colour</InputLabel>
                            <Select
                                labelId="gradient-select-label"
                                id="gradient-select"
                                defaultValue={defaultParameters.gradient}
                                onChange={onGradientChange}
                            >
                                {GRADIENTS.map(g => (
                                    <MenuItem value={g.name} key={g.name}>
                                        {g.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <Button
                            className={classes.button}
                            variant="text"
                            color="secondary"
                            onClick={onClearSpectrogram}
                            startIcon={<ClearIcon />}
                        >
                            Clear spectrogram
                        </Button>
                    </>
                </ScopedCssBaseline>
            </ThemeProvider>
        );
    };

    return [
        SettingsContainer,
        playState => {
            if (setPlayStateExport !== null) {
                setPlayStateExport(playState);
            } else {
                throw new Error('Attempt to set play state before component mount');
            }
        }
    ];
}

export default generateSettingsContainer;
