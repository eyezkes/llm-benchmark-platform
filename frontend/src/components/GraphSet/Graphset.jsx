import { Box, ButtonGroup, Button } from "@mui/material";
import React from "react";
import Graph from "../Graph/Graph";
import { dataset } from "../../constants/data";

const Graphset = () => {
  const [category, setCategory] = React.useState(0);
  const categories = ["cat1", "cat2", "cat3"];

  const onBtnClick = (e, id) => {
    e.preventDefault();
    setCategory(id);
  };

  return (
    <Box>
      <ButtonGroup size="large" variant="outlined">
        {categories.map((item, id) => (
          <Button
            variant={`${id == category ? "contained" : "outlined"}`}
            onClick={(e) => onBtnClick(e, id)}
            className="btn"
          >
            {item}
          </Button>
        ))}
      </ButtonGroup>
      <Graph dataset={dataset} cat={categories[category]} />
    </Box>
  );
};

export default Graphset;
