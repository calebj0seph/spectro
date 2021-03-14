import Slider from '@material-ui/core/Slider';
import Typography from '@material-ui/core/Typography';
import { makeStyles } from '@material-ui/core/styles';
import React, { ChangeEvent, useCallback, useRef, useEffect } from 'react';

const useStyles = makeStyles(() => ({
    sliderLabelContainer: {
        display: 'flex',
        justifyContent: 'space-between',
    },
}));

export interface LabelledSliderProps {
    nameLabelId: string;
    nameLabel: string;
    min: number;
    max: number;
    step?: number;
    defaultValue: number;
    onChange: (value: number) => void;
}

export type LabelledSlider = (props: LabelledSliderProps) => JSX.Element;

const castSliderValue = (value: number | number[]) => {
    if (typeof value === 'number') {
        return value;
    }
    return value[0];
};

// This is an ugly hack to be able to update the value label very quickly. Having a prop for the
// label and updating it as the slider is dragged causes severe stuttering of the spectrogram due to
// React taking CPU time re-rendering components.
function generateLabelledSlider(): [LabelledSlider, (value: string) => void] {
    let lastValueLabel: string = '';
    let span: HTMLSpanElement | null = null;
    const onSpanChange = (newSpan: HTMLSpanElement | null) => {
        if (newSpan !== null && newSpan !== span) {
            // Empty the node
            while (newSpan.firstChild) {
                newSpan.removeChild(newSpan.firstChild);
            }
            // Add a new single text node
            newSpan.appendChild(document.createTextNode(''));
        }
        span = newSpan;

        // Update the contents
        if (span !== null && span.firstChild !== null) {
            span.firstChild.nodeValue = lastValueLabel;
        }
    };

    const LabelledSlider = ({
        nameLabelId,
        nameLabel,
        min,
        max,
        step = 1,
        defaultValue,
        onChange,
    }: LabelledSliderProps) => {
        const classes = useStyles();

        const valueLabelRef = useRef<HTMLSpanElement | null>(null);
        useEffect(() => {
            onSpanChange(valueLabelRef.current);
        }, [valueLabelRef.current]);

        const changeCallback = useCallback(
            (_: ChangeEvent<{}>, value: number | number[]) => onChange(castSliderValue(value)),
            [onChange]
        );

        return (
            <>
                <div className={classes.sliderLabelContainer}>
                    <Typography id={nameLabelId} color="textSecondary" variant="caption">
                        {nameLabel}
                    </Typography>
                    <Typography color="textPrimary" variant="caption" ref={valueLabelRef} />
                </div>
                <Slider
                    aria-labelledby={nameLabelId}
                    step={step}
                    min={min}
                    max={max}
                    defaultValue={defaultValue}
                    onChange={changeCallback}
                />
            </>
        );
    };

    return [
        LabelledSlider,
        (value: string) => {
            lastValueLabel = value;
            onSpanChange(span);
        },
    ];
}

export default generateLabelledSlider;
