import Typography from '@mui/material/Typography';

export default function Text({children, variant='h1', ...props }) {
    return <Typography variant={variant} sx={{...props}}>{children}</Typography>;
}