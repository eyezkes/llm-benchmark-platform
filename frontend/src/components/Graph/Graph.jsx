import { BarChart } from '@mui/x-charts/BarChart';



const Graph = ({dataset, cat = 'cat1'}) => {
    
    
    
  const chartSettings = {
    xAxis: [{data: dataset.labels}],
    series : dataset[cat],
    height : 300,
    barLabel: 'value',
    margin: 0,
    width:500

  }  
  return (
    <div>
        <BarChart {...chartSettings}/>
    </div>
  )
}

export default Graph